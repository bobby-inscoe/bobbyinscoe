import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const ring = (points) => {
  if (
    points.length < 4 ||
    points.some((p) => p.length !== 2 || p.some((n) => !Number.isFinite(n)))
  )
    throw new Error('Invalid polygon ring');
  return `${quote(`(${points.map(([x, y]) => `(${x},${y})`).join(',')})`)}::polygon`;
};

// Generate an atomic reference-data load and backfill; no listing data leaves the database.
export function neighborhoodSeedSql(collection) {
  if (
    collection.type !== 'FeatureCollection' ||
    collection.features.length !== 96
  )
    throw new Error('Expected all 96 official Göteborg primary areas');
  const sql = ['begin;', 'lock table hs.listings in share row exclusive mode;'];
  const ids = new Set();
  for (const { properties: p, geometry: g } of collection.features) {
    if (
      !/^goteborg-\d{3}$/.test(p.id) ||
      ids.has(p.id) ||
      typeof p.name !== 'string' ||
      p.datasetVersion !== 'goteborg-primary-areas-2025'
    )
      throw new Error('Invalid neighborhood metadata');
    ids.add(p.id);
    sql.push(
      `insert into hs.neighborhoods(id,name,dataset_version) values (${quote(p.id)},${quote(p.name)},${quote(p.datasetVersion)}) on conflict(id) do update set name=excluded.name,dataset_version=excluded.dataset_version;`,
    );
    sql.push(
      `delete from hs.neighborhood_shapes where neighborhood_id=${quote(p.id)};`,
    );
    const polygons =
      g.type === 'Polygon'
        ? [g.coordinates]
        : g.type === 'MultiPolygon'
          ? g.coordinates
          : [];
    if (!polygons.length) throw new Error('Expected Polygon or MultiPolygon');
    polygons.forEach(([outline, ...holes], part) => {
      sql.push(
        `insert into hs.neighborhood_shapes(neighborhood_id,part,outline,holes) values (${quote(p.id)},${part},${ring(outline)},array[${holes.map(ring).join(',')}]::polygon[]);`,
      );
    });
  }
  sql.push(
    "update hs.listings set neighborhood_id=hs.neighborhood_for_coordinates(value->'coordinates');",
    'commit;',
  );
  return sql.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2])
    throw new Error(
      'Usage: node tools/house-scanner/neighborhoods-sql.mjs <output.sql>',
    );
  const data = JSON.parse(
    readFileSync(
      new URL(
        '../../supabase/data/goteborg-neighborhoods.geojson',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const sql = neighborhoodSeedSql(data);
  if (process.argv[2] === '--chunked') {
    const directory = process.argv[3];
    if (!directory)
      throw new Error('Specify an output directory after --chunked');
    mkdirSync(directory, { recursive: true });
    // The Management API rejects the full seed. Stage public SQL text in bounded
    // requests, then verify its hash and execute the original atomic seed once.
    const command = sql.slice('begin;\n'.length, -'\ncommit;'.length);
    const hash = createHash('md5').update(command).digest('hex');
    writeFileSync(
      join(directory, '000-start.sql'),
      `
      create table if not exists hs.neighborhood_seed_upload(part integer primary key, fragment text not null);
      alter table hs.neighborhood_seed_upload enable row level security;
      revoke all on hs.neighborhood_seed_upload from public,anon,authenticated,service_role;
      truncate hs.neighborhood_seed_upload;
    `,
    );
    for (
      let offset = 0, part = 0;
      offset < command.length;
      offset += 200000, part++
    )
      writeFileSync(
        join(directory, `${String(part + 1).padStart(3, '0')}-upload.sql`),
        `insert into hs.neighborhood_seed_upload values (${part},${quote(command.slice(offset, offset + 200000))});`,
      );
    writeFileSync(
      join(directory, '999-apply.sql'),
      `begin;
      do $seed$ declare command text; begin
        select string_agg(fragment,'' order by part) into command from hs.neighborhood_seed_upload;
        if md5(command) is distinct from '${hash}' then raise exception 'Incomplete neighborhood seed upload'; end if;
        execute command;
      end $seed$;
      drop table hs.neighborhood_seed_upload;
      commit;`,
    );
  } else writeFileSync(process.argv[2], sql);
}
