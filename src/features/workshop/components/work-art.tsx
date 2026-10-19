import { Wheat } from 'lucide-react';
import duck from '@/assets/duck.svg';

export function WorkArt({ kind }: { kind: string }) {
  if (kind === 'house-scanner') {
    return (
      <div className="scanner-art" aria-hidden="true">
        <span className="art-corner">HOUSE SCANNER</span>
        <svg viewBox="0 0 600 320" fill="none" aria-hidden="true">
          <path
            d="M60 260H540M80 100H520M150 50V280M450 50V280"
            stroke="currentColor"
            opacity=".15"
          />
          <path
            d="m210 165 90-75 90 75v95H210Z"
            stroke="currentColor"
            strokeWidth="3"
          />
          <path
            d="M280 260v-65h40v65M235 175h25v30h-25Z"
            stroke="currentColor"
            strokeWidth="3"
          />
          <circle cx="455" cy="185" r="24" fill="currentColor" opacity=".13" />
          <path d="m444 185 8 8 15-17" stroke="currentColor" strokeWidth="3" />
        </svg>
        <span className="scanner-art-caption">A shared home shortlist</span>
      </div>
    );
  }
  if (kind === 'common-basket') {
    return (
      <div className="basket-art" aria-hidden="true">
        <span className="art-corner">COMMON BASKET / CONCEPT</span>
        <div className="list-sheet">
          <span className="list-handwriting">Groceries</span>
          <div>
            <i className="checked" />
            Oat milk<span className="person-mark">J</span>
          </div>
          <div>
            <i />
            Spinach<span className="person-mark">B</span>
          </div>
          <div>
            <i />
            Sourdough
          </div>
          <div>
            <i />
            Lemons<span className="person-mark">J</span>
          </div>
        </div>
        <div className="basket-circle" />
      </div>
    );
  }
  if (kind === 'across-the-ledger') {
    return (
      <div className="ledger-art" aria-hidden="true">
        <span className="art-corner">ACROSS THE LEDGER / CONCEPT</span>
        <div className="ledger-columns">
          <div>
            <span className="ledger-country">US</span>
            <span>
              Gains
              <br />& losses
            </span>
            <div className="ledger-lines" />
          </div>
          <span className="ledger-arrow">↗</span>
          <div>
            <span className="ledger-country">SE</span>
            <span>
              Swedish
              <br />
              tax reporting
            </span>
            <div className="ledger-lines" />
          </div>
        </div>
      </div>
    );
  }
  if (kind === 'position-notes') {
    return (
      <div className="research-art" aria-hidden="true">
        <span className="art-corner">POSITION NOTES / CONCEPT</span>
        <span className="research-heading">Options</span>
        <svg
          aria-hidden="true"
          className="research-chart"
          viewBox="0 0 600 260"
          fill="none"
        >
          <path
            d="M40 30V225H570M40 150H570"
            stroke="currentColor"
            opacity=".35"
          />
          <path
            d="M50 195H225L390 65H550"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path
            d="M225 30V225M390 30V225"
            stroke="currentColor"
            opacity=".3"
            strokeDasharray="3 5"
          />
          <circle cx="308" cy="130" r="5" fill="currentColor" />
          <path d="m319 119 28-30h52" stroke="currentColor" />
        </svg>
        <div className="research-labels">
          <span>risk</span>
          <span>reward</span>
        </div>
      </div>
    );
  }
  return (
    <div className="duck-art" aria-hidden="true">
      <div className="pond-rings">
        <i />
        <i />
        <i />
      </div>
      <span className="art-corner">DUCK FEED</span>
      <span className="preview-title">
        Feed
        <br />
        the duck.
      </span>
      <img
        className="preview-duck"
        src={duck}
        alt=""
        width="220"
        height="220"
      />
      <Wheat className="preview-wheat wheat-one" size={35} strokeWidth={1.2} />
      <Wheat className="preview-wheat wheat-two" size={26} strokeWidth={1.2} />
      <Wheat
        className="preview-wheat wheat-three"
        size={31}
        strokeWidth={1.2}
      />

      <span className="preview-play">↗</span>
    </div>
  );
}
