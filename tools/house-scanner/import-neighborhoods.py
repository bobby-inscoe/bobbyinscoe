"""Convert Göteborg's official CC0 primärområden ZIP; requires pyshp and pyproj."""
import io
import json
import pathlib
import sys
import zipfile

import pyproj
import shapefile

root = pathlib.Path(__file__).resolve().parents[2]
with zipfile.ZipFile(sys.argv[1]) as archive:
    def content(suffix):
        return io.BytesIO(archive.read(next(n for n in archive.namelist() if n.endswith(suffix))))

    reader = shapefile.Reader(shp=content('.shp'), dbf=content('.dbf'), encoding='cp1252')
    projection = content('.prj').read().decode()
    transform = pyproj.Transformer.from_crs(pyproj.CRS.from_wkt(projection), 4326, always_xy=True)

    def project(value):
        if isinstance(value[0], (int, float)):
            return [round(v, 7) for v in transform.transform(*value)]
        return [project(child) for child in value]

    features = []
    for record in reader.iterShapeRecords():
        values = list(record.record)
        geometry = record.shape.__geo_interface__
        geometry['coordinates'] = project(geometry['coordinates'])
        features.append({'type': 'Feature', 'properties': {
            'id': 'goteborg-' + values[4], 'name': values[7],
            'datasetVersion': 'goteborg-primary-areas-2025'
        }, 'geometry': geometry})
    features.sort(key=lambda f: f['properties']['id'])
    assert len(features) == len({f['properties']['id'] for f in features}) == 96
    (root / 'supabase/data/goteborg-neighborhoods.geojson').write_text(json.dumps({
        'type': 'FeatureCollection', 'features': features
    }, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf8')
    (root / 'src/features/house-scanner/assets/neighborhoods.json').write_text(json.dumps([
        {'id': f['properties']['id'], 'name': f['properties']['name']} for f in features
    ], ensure_ascii=False, indent=2) + '\n', encoding='utf8')
