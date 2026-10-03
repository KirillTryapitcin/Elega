# Authorization policy matrix

Status: accepted with the Step 2 blueprint. The tables below are mirrored in
`packages/shared/src/policy/matrix.ts`; `matrix.test.ts` fails when the two disagree, so change
both together. The API generates one test per cell from that data (brief §29.3,
`apps/api/test/policy.int.test.ts`); each row is enforced from the milestone that ships its
resource, and rows from later milestones are listed as pending tests until then.

## Actors

Relation of the viewer to the resource owner (or to the group / conversation).

| Code | Actor |
| --- | --- |
| `anon` | Not signed in |
| `owner` | The resource's author or account owner |
| `friend` | Accepted friendship with the owner |
| `fof` | Friend of a friend, not a friend |
| `follower` | Follows the owner, not a friend |
| `stranger` | Signed in, no relation |
| `blocked` | Either side has blocked the other |
| `gmember` | Active member of the group the resource belongs to |
| `gmod` | Group owner, admin or moderator |
| `staff` | Platform moderator or admin (role check + 2FA) |

Two modifiers apply on top of every cell:
- **Minor owner** (owner under 18): anything that is `Y` for `fof`, `follower`, `stranger`
  or `anon` on profile, posts, friends list and search becomes `N`.
- **Unverified viewer** (email not confirmed): no messages to non-friends, no public posts,
  no friend requests to strangers.

Legend: `Y` allowed · `N` denied · `A` depends on the item's audience or the owner's
setting · `—` not applicable. `blocked` is `N` for every read and write, without exception;
the API returns `404`, not `403`, so a block is not revealed.

## Profiles and relationships

| Resource · action | anon | owner | friend | fof | follower | stranger | blocked | staff |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Profile: name, avatar, username | A¹ | Y | Y | Y | Y | Y | N | Y |
| Profile: other fields | A² | Y | A² | A² | A² | A² | N | Y³ |
| Profile: edit | N | Y | N | N | N | N | N | N |
| Friends list | A² | Y | A² | A² | A² | A² | N | Y³ |
| Send friend request | N | — | — | A⁴ | A⁴ | A⁴ | N | — |
| Follow | N | — | Y | A⁵ | — | A⁵ | N | — |
| Send direct message | N | — | Y | A⁶ | A⁶ | A⁶ | N | N |
| Mention in post or comment | N | — | A⁷ | A⁷ | A⁷ | A⁷ | N | — |
| Block / mute | N | — | Y | Y | Y | Y | Y | — |
| Sessions, settings, export, delete | N | Y | N | N | N | N | N | N |

¹ Public profiles are visible to anonymous users only if the owner opted into indexing.
² Per-field audience from `user_profiles.profile_visibility_json`.
³ Staff see full profiles in the admin view only, every view written to `audit_log`.
⁴ `who_can_send_friend_requests`. ⁵ `allow_followers`. ⁶ `who_can_message`; non-friends land
in message requests. ⁷ `who_can_mention`.

## Posts, comments and reactions

| Resource · action | anon | owner | friend | fof | follower | stranger | blocked | staff |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Read post, audience `public` | A¹ | Y | Y | Y | Y | Y | N | Y |
| Read post, `friends` | N | Y | Y | N | N | N | N | Y |
| Read post, `close_friends` / `custom_list` / `specific_users` | N | Y | A⁸ | N | N | N | N | Y |
| Read post, `only_me` | N | Y | N | N | N | N | N | Y³ |
| Edit / delete post | N | Y | N | N | N | N | N | Remove only |
| View edit history | N | Y | N | N | N | N | N | Y |
| React / comment | N | Y⁹ | Y⁹ | Y⁹ | Y⁹ | Y⁹ | N | N |
| Edit / delete own comment | N | Y | Y | Y | Y | Y | N | Remove only |
| Hide / delete others' comments on own post | N | Y | — | — | — | — | — | Remove only |
| Share | N | Y | A¹⁰ | A¹⁰ | A¹⁰ | A¹⁰ | N | N |
| Bookmark | N | Y | Y⁹ | Y⁹ | Y⁹ | Y⁹ | N | N |
| Report | N | — | Y⁹ | Y⁹ | Y⁹ | Y⁹ | Y¹¹ | — |

⁸ Viewer is in the owner's close-friends set, the referenced list, or `post_audience_users`.
⁹ Only on posts the viewer can read; comments also require `comments_enabled`.
¹⁰ Share is allowed, but the shared copy shows the original only to viewers who can read it.
¹¹ A blocked user can still report content they saw before the block (via report history).

## Stories

| Action | anon | owner | friend | close friend | stranger | blocked | staff |
| --- | --- | --- | --- | --- | --- | --- | --- |
| View, audience `friends` | N | Y | Y | Y | N | N | Y |
| View, `close_friends` | N | Y | N | Y | N | N | Y |
| View, `public` (adult owners and pages) | N | Y | Y | Y | Y | N | Y |
| See viewers list | N | Y | N | N | N | N | N |
| Reply (creates a DM) | N | — | A⁶ | A⁶ | A⁶ | N | N |

## Chat

| Action | non-member | member | conversation admin | conversation owner | blocked counterpart | staff |
| --- | --- | --- | --- | --- | --- | --- |
| Read messages | N | Y | Y | Y | N | N¹² |
| Send | N | Y | Y | Y | N | N |
| Edit own message (15 min) | N | Y | Y | Y | N | N |
| Delete for everyone (own, window) | N | Y | Y | Y | N | N |
| Rename, change avatar | N | N | Y | Y | — | N |
| Add / remove members | N | N | Y | Y | — | N |
| Remove admin, transfer ownership | N | N | N | Y | — | N |

¹² Staff read only messages attached to a report, through the report context view, logged.

## Groups

| Action | anon | stranger | gmember | gmod | owner | banned member | staff |
| --- | --- | --- | --- | --- | --- | --- | --- |
| See group exists, `public` / `closed` | A¹ | Y | Y | Y | Y | Y | Y |
| See group exists, `secret` | N | N | Y | Y | Y | N | Y |
| Read posts, `public` | A¹ | Y | Y | Y | Y | N | Y |
| Read posts, `closed` / `secret` | N | N | Y | Y | Y | N | Y |
| Join `public` | N | Y | — | — | — | N | — |
| Request to join `closed` | N | Y | — | — | — | N | — |
| Post (subject to approval queue) | N | N | Y | Y | Y | N | N |
| Approve posts and members, mute, ban | N | N | N | Y | Y | N | N |
| Edit rules, settings, roles | N | N | N | Admin+ | Y | N | N |
| Delete group, transfer ownership | N | N | N | N | Y | N | N |
| Remove content | N | N | Own | Y | Y | N | Y |

## Pages and events

| Action | anon | follower / stranger | page analyst | page editor | page admin | staff |
| --- | --- | --- | --- | --- | --- | --- |
| Read page and posts | A¹ | Y | Y | Y | Y | Y |
| Post or reply as page | N | N | N | Y | Y | N |
| View insights | N | N | Y | Y | Y | N |
| Manage roles, delete page | N | N | N | N | Y | N |
| Verify page | N | N | N | N | N | Admin |

Events follow their host: a user event inherits friend rules, a group event inherits group
rules, a page event is public. RSVP requires being able to see the event; the guest list is
visible to people who can see the event, minus guests who hid their RSVP.

## Moderation and admin

| Action | user | moderator | analyst | admin |
| --- | --- | --- | --- | --- |
| File report, see own reports | Y | Y | Y | Y |
| Appeal action against self | Y | Y | Y | Y |
| Work report queue, act on content and users | N | Y | N | Y |
| Review appeals (not own decisions) | N | Y | N | Y |
| Shadow-hold, permanent ban | N | N | N | Y |
| View metrics dashboards | N | Y | Y | Y |
| Feature flags, banned terms, invites, registration throttle | N | N | N | Y |
| Read audit log | N | Own actions | N | Y |
| Impersonate a user | N | N | N | N |

All staff actions require 2FA, are written to `audit_log` with a justification, and live
under `/api/v1/admin/*`, which can additionally be IP-restricted.

## How it is enforced

- One CASL ability per request, built from the principal and the loaded resource; the
  policy guard runs before the controller on every route (`@Policy(action, subject)` is
  mandatory: a route without one fails a startup check).
- List queries use `VisibilityService` SQL fragments (audience, blocks both ways, mutes,
  minors, deleted, moderation state), so lists and single reads cannot disagree.
- Tests: generated from this matrix, actor fixtures for every column, one assertion per
  cell, across REST and the WebSocket gateway; plus property tests that random actor/resource
  pairs never see `only_me` or blocked content.
