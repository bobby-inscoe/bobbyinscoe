export const WORKS = [
  {
    id: 'duck-feed',
    title: 'Duck Feed',
    label: 'Browser game',
    description:
      'A browser game where you chase food, build combos, and try to beat your best score.',
    paragraphs: [
      'Choose a duck or snail and a round length. Bonus crumbs add time; high scores are saved in your browser.',
    ],
    facts: [
      ['Format', 'Browser game'],
      ['Built with', 'React + TypeScript'],
      ['Controls', 'Pointer or keyboard'],
      ['Round length', '15, 30 or 60 seconds'],
    ],
  },
  {
    id: 'common-basket',
    title: 'Basket',
    label: 'Proof of concept',
    description:
      'Several people can edit the same grocery list. An early proof of concept.',
    paragraphs: [],
    facts: [['Focus', 'Collaborative editing']],
  },
  {
    id: 'across-the-ledger',
    title: 'Tax Bridge',
    label: 'Tax reporting',
    description:
      'Converts US investment gains and losses into a format for reporting to Skatteverket.',
    paragraphs: [],
    facts: [
      ['Input', 'US investment gains + losses'],
      ['Output', 'Swedish tax reporting format'],
    ],
  },
  {
    id: 'position-notes',
    title: 'Position Notes',
    label: 'MCP server',
    description:
      'Research options with Schwab data and compare a position’s potential risk and reward through an MCP server.',
    paragraphs: [],
    facts: [
      ['Data source', 'Schwab'],
      ['Focus', 'Options risk + reward'],
    ],
  },
  {
    id: 'house-scanner',
    title: 'Shellter',
    label: 'Timmy’s Picks',
    description:
      'A shared home shortlist powered by live listings from connected sources. Save favorites, track viewings, and compare homes on a map.',
    paragraphs: [],
    facts: [
      ['Format', 'Private household workspace'],
      ['Listings', 'Live connected sources'],
    ],
  },
] as const;
export type Work = (typeof WORKS)[number];
