# Direct and group messaging

Date: 2026-08-01
Owner request: "For chat, please allow the users to start chats with each
other or form groups, the general chat does not make sense."

## What already exists

The premise behind the request is only half true. The company-wide "General"
room is what the owner *sees*, but it is not all the code has.

`supabase/migrations/20260429000002_teams_style_chat.sql` (shipped
2026-04-29) already introduced a three-kind conversation model:

| Table | Purpose |
| --- | --- |
| `chat_conversations` | `kind` enum `channel` / `group` / `dm`, `company_id`, `name`, `is_default` |
| `chat_conversation_members` | explicit membership for groups and DMs |
| `team_messages` | messages, now carrying `conversation_id` |
| `chat_attachments` | per-message files in a private storage bucket |

`can_access_conversation(uuid)` is the single gate: channels are open to any
`company_members` row for that company, groups and DMs require an explicit
`chat_conversation_members` row. Every SELECT / INSERT policy on
`chat_conversations`, `chat_conversation_members`, `team_messages` and
`chat_attachments` routes through it.

The UI exists too. `components/chat/ConversationSidebar.tsx` has a "New group"
dialog with a member multi-select and a "Start a direct message" dialog with a
search box. `app/c/[publicId]/chat/actions.ts` has `createGroup`,
`createOrOpenDm`, `addGroupMember` and `leaveConversation`.

Production confirms it is deployed and reachable: 4 companies, 4 auto-seeded
General channels, and one real private group ("miles", 2 of the 3 Techno
Optics members) created 2026-07-17. Zero DMs have ever been created.

**So the feature is not missing. It is unfindable.** Two things hide it:

1. `app/c/[publicId]/chat/page.tsx` does not render anything. It looks up the
   default channel and `redirect()`s straight into it. Chat therefore *is*
   General, every single time you open it, which is exactly the experience the
   owner is describing.
2. The only routes to a DM or a group are two 11px `+ New` text links tucked
   into sidebar section headers. They are well under the 44px tap target this
   app needs inside mobile WebViews, and on a phone the sidebar is a tall card
   stacked above the conversation, so the links are easy to scroll past.

## Design decisions

### General survives, and stops being the front door

General stays exactly as it is: same row, same `is_default` flag, same
history, same auto-seed trigger for new companies. Nothing is migrated,
renamed or deleted. It simply stops being a forced redirect target and becomes
one row in a conversation list.

Removing it would destroy history and would also break the trigger that new
companies depend on. There is no upside.

### `/chat` becomes an inbox

The landing route renders a conversation list ordered by most recent activity,
with two primary buttons above it: **New message** and **New group**. Every row
is a link, minimum 44px tall, showing who or what the conversation is, the last
message, and its time.

This is the whole of the owner's ask. Person-to-person conversation becomes
the first thing you see instead of a room you never asked for.

### Who can talk to whom

Members of the same company, which is `company_members(company_id, user_id,
role)`. Roles are `manager` and `expenser` (and the rail already lets an
`expenser` reach chat). No cross-company messaging, no external invites.
This was already the rule; it is unchanged.

### Group membership

- Any current member of a group can add another current company member.
- Anyone can leave a group or a DM.
- The group's creator, or a company manager, can remove someone else from a
  group. This did not exist before: the only DELETE policy was self-leave, so
  a group had no way to un-invite anyone.
- Nobody can be removed from a DM, and a DM can never grow past two people.

### Leaving the company

Today, nothing happens, and that is a bug (see below). After this change,
losing your `company_members` row costs you access to every conversation in
that company, immediately and at the database level. Your existing messages
stay where they are, because deleting them would rewrite other people's
history.

### Unread state, and deliberately no new nagging

The owner recently and explicitly asked to be nagged less, so this adds
**no** push notification, **no** badge on the left rail, and **no** entry in
the outstanding-tasks bell. `components/OutstandingTasksBell.tsx` is not
touched.

An inbox that cannot tell you which conversation has something new is not an
inbox, though, so there is one quiet affordance: a `chat_conversation_reads`
table holding one `(conversation, user, last_read_at)` row, stamped when you
open a conversation, rendered as a small dot on the inbox row and nowhere
else. You only see it on the page whose job it is to show it.

It is a table rather than a column on `chat_conversation_members` because
channels carry no membership rows at all, and one mechanism covering all
three kinds beats two that each cover part.

## Access control

This is the part that has to be right, because a leak here exposes private
conversations between colleagues.

Two holes were found in the live policies and confirmed by running queries as
the affected user against production inside a rolled-back transaction.

**Hole A: a former employee keeps reading.** `can_access_conversation` checks
`company_members` only on the `channel` branch. For groups and DMs it checks
`chat_conversation_members` alone, and removing someone from a company does
not touch that table. An employee removed from `company_members` still read
the group's messages.

**Hole C: a 1:1 DM could be turned into a 3-way.** The
`conv-members: insert by member` policy allows an insert whenever the actor
passes `can_access_conversation`, with no check on the conversation's `kind`.
Either participant in a DM could therefore add a third company member
straight from the client and hand them the entire private history, without the
other participant agreeing or being told. The server action refuses this; RLS
did not, and RLS is what has to hold.

(Two further suspicions did not hold up and are recorded so nobody re-checks
them: adding a *different company's* user is already blocked by the
2026-07-26 audit migration, and the `created_by` escape hatch in the insert
policy is self-nullifying, because the subquery it uses is itself subject to
`chat_conversations` RLS.)

### The fix

1. `can_access_conversation` requires a current `company_members` row for the
   conversation's company on **every** branch.
2. `conv-members: insert by member` requires the conversation to be a `group`,
   the actor to be a current member of it, and the target to be a current
   member of the company. The `created_by` escape hatch goes.
3. A new DELETE policy adds "group creator or company manager may remove a
   member of a group" alongside the existing self-leave.
4. An `after delete on company_members` trigger clears that user's
   `chat_conversation_members` rows for that company, so the data matches the
   policy instead of relying on it.

The server actions all run through the service-role client, which bypasses
RLS, so tightening these policies cannot break the app's own write paths. It
only closes the direct-from-client paths.

### Migration safety

Additive only. One new table, one function replacement, three policy
replacements, one trigger. No table, column, row or policy that carries data
is dropped. The one-off backfill that clears orphaned membership rows was
counted against production first and matches zero rows today. Rollback is
re-running the previous `create policy` / `create or replace function`
bodies, which are quoted in the migration header; the reads table can be left
in place harmlessly.

## Testing

`supabase/tests/rls-chat-conversations.sql`, in the same style as the existing
`rls-tier2-isolation.sql`: seed scratch companies and users inside a
transaction, impersonate each one with `set local role authenticated` plus
`request.jwt.claims`, assert, `rollback`. It proves, as actual queries rather
than as an argument about policy text:

- a company member who is not in a DM reads zero of its messages
- a company member who is not in a group reads zero of its messages
- both of them see zero rows for that conversation in `chat_conversations`
- a participant cannot add a third person to a DM
- a former employee reads zero messages from a group they used to be in
- and, as a control, that actual participants still read what they should

`lib/chat/inbox.ts` holds the pure inbox-shaping logic (titles, previews,
ordering, unread) with unit tests in `lib/chat/inbox.test.ts`.

## Out of scope

Message editing, reactions, threads, typing indicators, read receipts visible
to other people, renaming or archiving a conversation, and anything that
notifies anyone anywhere.
