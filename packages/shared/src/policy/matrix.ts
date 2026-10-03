/**
 * The authorization policy matrix (docs/authorization-matrix.md) as data. `matrix.test.ts`
 * fails when the two drift apart; the API generates one test per cell from it, enforcing
 * each row from the milestone that ships the resource (brief §29.3).
 *
 * Cells: `Y` allowed, `N` denied, `A` depends on audience or the owner's setting, `—` not
 * applicable; superscripts point to the footnotes in the document.
 */
export type Milestone = `M${number}`;

export interface PolicyRow {
  readonly action: string;
  readonly cells: readonly string[];
  /** The milestone that implements the resource and starts enforcing this row. */
  readonly milestone: Milestone;
}

export interface PolicyTable {
  readonly id: string;
  readonly title: string;
  /** First column header (what each row is about). */
  readonly subject: string;
  readonly actors: readonly string[];
  readonly rows: readonly PolicyRow[];
}

export const POLICY_MATRIX: readonly PolicyTable[] = [
  {
    id: 'profiles',
    title: 'Profiles and relationships',
    subject: 'Resource · action',
    actors: ['anon', 'owner', 'friend', 'fof', 'follower', 'stranger', 'blocked', 'staff'],
    rows: [
      {
        action: 'Profile: name, avatar, username',
        milestone: 'M2',
        cells: ['A¹', 'Y', 'Y', 'Y', 'Y', 'Y', 'N', 'Y'],
      },
      {
        action: 'Profile: other fields',
        milestone: 'M2',
        cells: ['A²', 'Y', 'A²', 'A²', 'A²', 'A²', 'N', 'Y³'],
      },
      { action: 'Profile: edit', milestone: 'M2', cells: ['N', 'Y', 'N', 'N', 'N', 'N', 'N', 'N'] },
      {
        action: 'Friends list',
        milestone: 'M3',
        cells: ['A²', 'Y', 'A²', 'A²', 'A²', 'A²', 'N', 'Y³'],
      },
      {
        action: 'Send friend request',
        milestone: 'M3',
        cells: ['N', '—', '—', 'A⁴', 'A⁴', 'A⁴', 'N', '—'],
      },
      { action: 'Follow', milestone: 'M3', cells: ['N', '—', 'Y', 'A⁵', '—', 'A⁵', 'N', '—'] },
      {
        action: 'Send direct message',
        milestone: 'M7',
        cells: ['N', '—', 'Y', 'A⁶', 'A⁶', 'A⁶', 'N', 'N'],
      },
      {
        action: 'Mention in post or comment',
        milestone: 'M4',
        cells: ['N', '—', 'A⁷', 'A⁷', 'A⁷', 'A⁷', 'N', '—'],
      },
      { action: 'Block / mute', milestone: 'M3', cells: ['N', '—', 'Y', 'Y', 'Y', 'Y', 'Y', '—'] },
      {
        action: 'Sessions, settings, export, delete',
        milestone: 'M1',
        cells: ['N', 'Y', 'N', 'N', 'N', 'N', 'N', 'N'],
      },
    ],
  },
  {
    id: 'posts',
    title: 'Posts, comments and reactions',
    subject: 'Resource · action',
    actors: ['anon', 'owner', 'friend', 'fof', 'follower', 'stranger', 'blocked', 'staff'],
    rows: [
      {
        action: 'Read post, audience `public`',
        milestone: 'M4',
        cells: ['A¹', 'Y', 'Y', 'Y', 'Y', 'Y', 'N', 'Y'],
      },
      {
        action: 'Read post, `friends`',
        milestone: 'M4',
        cells: ['N', 'Y', 'Y', 'N', 'N', 'N', 'N', 'Y'],
      },
      {
        action: 'Read post, `close_friends` / `custom_list` / `specific_users`',
        milestone: 'M4',
        cells: ['N', 'Y', 'A⁸', 'N', 'N', 'N', 'N', 'Y'],
      },
      {
        action: 'Read post, `only_me`',
        milestone: 'M4',
        cells: ['N', 'Y', 'N', 'N', 'N', 'N', 'N', 'Y³'],
      },
      {
        action: 'Edit / delete post',
        milestone: 'M4',
        cells: ['N', 'Y', 'N', 'N', 'N', 'N', 'N', 'Remove only'],
      },
      {
        action: 'View edit history',
        milestone: 'M4',
        cells: ['N', 'Y', 'N', 'N', 'N', 'N', 'N', 'Y'],
      },
      {
        action: 'React / comment',
        milestone: 'M4',
        cells: ['N', 'Y⁹', 'Y⁹', 'Y⁹', 'Y⁹', 'Y⁹', 'N', 'N'],
      },
      {
        action: 'Edit / delete own comment',
        milestone: 'M4',
        cells: ['N', 'Y', 'Y', 'Y', 'Y', 'Y', 'N', 'Remove only'],
      },
      {
        action: "Hide / delete others' comments on own post",
        milestone: 'M4',
        cells: ['N', 'Y', '—', '—', '—', '—', '—', 'Remove only'],
      },
      { action: 'Share', milestone: 'M4', cells: ['N', 'Y', 'A¹⁰', 'A¹⁰', 'A¹⁰', 'A¹⁰', 'N', 'N'] },
      { action: 'Bookmark', milestone: 'M4', cells: ['N', 'Y', 'Y⁹', 'Y⁹', 'Y⁹', 'Y⁹', 'N', 'N'] },
      { action: 'Report', milestone: 'M4', cells: ['N', '—', 'Y⁹', 'Y⁹', 'Y⁹', 'Y⁹', 'Y¹¹', '—'] },
    ],
  },
  {
    id: 'stories',
    title: 'Stories',
    subject: 'Action',
    actors: ['anon', 'owner', 'friend', 'close friend', 'stranger', 'blocked', 'staff'],
    rows: [
      {
        action: 'View, audience `friends`',
        milestone: 'M10',
        cells: ['N', 'Y', 'Y', 'Y', 'N', 'N', 'Y'],
      },
      {
        action: 'View, `close_friends`',
        milestone: 'M10',
        cells: ['N', 'Y', 'N', 'Y', 'N', 'N', 'Y'],
      },
      {
        action: 'View, `public` (adult owners and pages)',
        milestone: 'M10',
        cells: ['N', 'Y', 'Y', 'Y', 'Y', 'N', 'Y'],
      },
      { action: 'See viewers list', milestone: 'M10', cells: ['N', 'Y', 'N', 'N', 'N', 'N', 'N'] },
      {
        action: 'Reply (creates a DM)',
        milestone: 'M10',
        cells: ['N', '—', 'A⁶', 'A⁶', 'A⁶', 'N', 'N'],
      },
    ],
  },
  {
    id: 'chat',
    title: 'Chat',
    subject: 'Action',
    actors: [
      'non-member',
      'member',
      'conversation admin',
      'conversation owner',
      'blocked counterpart',
      'staff',
    ],
    rows: [
      { action: 'Read messages', milestone: 'M7', cells: ['N', 'Y', 'Y', 'Y', 'N', 'N¹²'] },
      { action: 'Send', milestone: 'M7', cells: ['N', 'Y', 'Y', 'Y', 'N', 'N'] },
      {
        action: 'Edit own message (15 min)',
        milestone: 'M7',
        cells: ['N', 'Y', 'Y', 'Y', 'N', 'N'],
      },
      {
        action: 'Delete for everyone (own, window)',
        milestone: 'M7',
        cells: ['N', 'Y', 'Y', 'Y', 'N', 'N'],
      },
      { action: 'Rename, change avatar', milestone: 'M7', cells: ['N', 'N', 'Y', 'Y', '—', 'N'] },
      { action: 'Add / remove members', milestone: 'M7', cells: ['N', 'N', 'Y', 'Y', '—', 'N'] },
      {
        action: 'Remove admin, transfer ownership',
        milestone: 'M7',
        cells: ['N', 'N', 'N', 'Y', '—', 'N'],
      },
    ],
  },
  {
    id: 'groups',
    title: 'Groups',
    subject: 'Action',
    actors: ['anon', 'stranger', 'gmember', 'gmod', 'owner', 'banned member', 'staff'],
    rows: [
      {
        action: 'See group exists, `public` / `closed`',
        milestone: 'M9',
        cells: ['A¹', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y'],
      },
      {
        action: 'See group exists, `secret`',
        milestone: 'M9',
        cells: ['N', 'N', 'Y', 'Y', 'Y', 'N', 'Y'],
      },
      {
        action: 'Read posts, `public`',
        milestone: 'M9',
        cells: ['A¹', 'Y', 'Y', 'Y', 'Y', 'N', 'Y'],
      },
      {
        action: 'Read posts, `closed` / `secret`',
        milestone: 'M9',
        cells: ['N', 'N', 'Y', 'Y', 'Y', 'N', 'Y'],
      },
      { action: 'Join `public`', milestone: 'M9', cells: ['N', 'Y', '—', '—', '—', 'N', '—'] },
      {
        action: 'Request to join `closed`',
        milestone: 'M9',
        cells: ['N', 'Y', '—', '—', '—', 'N', '—'],
      },
      {
        action: 'Post (subject to approval queue)',
        milestone: 'M9',
        cells: ['N', 'N', 'Y', 'Y', 'Y', 'N', 'N'],
      },
      {
        action: 'Approve posts and members, mute, ban',
        milestone: 'M9',
        cells: ['N', 'N', 'N', 'Y', 'Y', 'N', 'N'],
      },
      {
        action: 'Edit rules, settings, roles',
        milestone: 'M9',
        cells: ['N', 'N', 'N', 'Admin+', 'Y', 'N', 'N'],
      },
      {
        action: 'Delete group, transfer ownership',
        milestone: 'M9',
        cells: ['N', 'N', 'N', 'N', 'Y', 'N', 'N'],
      },
      { action: 'Remove content', milestone: 'M9', cells: ['N', 'N', 'Own', 'Y', 'Y', 'N', 'Y'] },
    ],
  },
  {
    id: 'pages',
    title: 'Pages and events',
    subject: 'Action',
    actors: ['anon', 'follower / stranger', 'page analyst', 'page editor', 'page admin', 'staff'],
    rows: [
      { action: 'Read page and posts', milestone: 'M9', cells: ['A¹', 'Y', 'Y', 'Y', 'Y', 'Y'] },
      { action: 'Post or reply as page', milestone: 'M9', cells: ['N', 'N', 'N', 'Y', 'Y', 'N'] },
      { action: 'View insights', milestone: 'M9', cells: ['N', 'N', 'Y', 'Y', 'Y', 'N'] },
      {
        action: 'Manage roles, delete page',
        milestone: 'M9',
        cells: ['N', 'N', 'N', 'N', 'Y', 'N'],
      },
      { action: 'Verify page', milestone: 'M9', cells: ['N', 'N', 'N', 'N', 'N', 'Admin'] },
    ],
  },
  {
    id: 'moderation',
    title: 'Moderation and admin',
    subject: 'Action',
    actors: ['user', 'moderator', 'analyst', 'admin'],
    rows: [
      { action: 'File report, see own reports', milestone: 'M11', cells: ['Y', 'Y', 'Y', 'Y'] },
      { action: 'Appeal action against self', milestone: 'M11', cells: ['Y', 'Y', 'Y', 'Y'] },
      {
        action: 'Work report queue, act on content and users',
        milestone: 'M11',
        cells: ['N', 'Y', 'N', 'Y'],
      },
      {
        action: 'Review appeals (not own decisions)',
        milestone: 'M11',
        cells: ['N', 'Y', 'N', 'Y'],
      },
      { action: 'Shadow-hold, permanent ban', milestone: 'M11', cells: ['N', 'N', 'N', 'Y'] },
      { action: 'View metrics dashboards', milestone: 'M11', cells: ['N', 'Y', 'Y', 'Y'] },
      {
        action: 'Feature flags, banned terms, invites, registration throttle',
        milestone: 'M11',
        cells: ['N', 'N', 'N', 'Y'],
      },
      { action: 'Read audit log', milestone: 'M11', cells: ['N', 'Own actions', 'N', 'Y'] },
      { action: 'Impersonate a user', milestone: 'M11', cells: ['N', 'N', 'N', 'N'] },
    ],
  },
];

const SUPERSCRIPT_DIGITS = new Set('⁰¹²³⁴⁵⁶⁷⁸⁹');

/** The base decision of a cell, without its footnote. */
export function cellDecision(cell: string): 'Y' | 'N' | 'A' | '—' | 'other' {
  // A plain scan rather than a trailing-repetition regex, which backtracks polynomially.
  let end = cell.length;
  while (end > 0 && SUPERSCRIPT_DIGITS.has(cell.charAt(end - 1))) end -= 1;
  const base = cell.slice(0, end);
  return base === 'Y' || base === 'N' || base === 'A' || base === '—' ? base : 'other';
}

/** Looks up one cell; throws on an unknown table, action or actor so tests cannot pass vacuously. */
export function policyCell(tableId: string, action: string, actor: string): string {
  const table = POLICY_MATRIX.find((item) => item.id === tableId);
  const row = table?.rows.find((item) => item.action === action);
  const column = table?.actors.indexOf(actor) ?? -1;
  const cell = column >= 0 ? row?.cells[column] : undefined;
  if (cell === undefined) throw new Error(`No policy cell ${tableId} / ${action} / ${actor}`);
  return cell;
}
