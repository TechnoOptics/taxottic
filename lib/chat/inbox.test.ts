import { describe, expect, it } from "vitest";
import {
  buildInbox,
  displayNameFor,
  latestByConversation,
  type InboxConversation,
  type InboxMember,
  type InboxMessage,
} from "./inbox";

const ME = "user-me";
const SAM = "user-sam";
const JO = "user-jo";

const members: InboxMember[] = [
  { user_id: ME, full_name: "Riley Owner", email: "riley@example.com" },
  { user_id: SAM, full_name: "Sam Diaz", email: "sam@example.com" },
  { user_id: JO, full_name: null, email: "jo.baker@example.com" },
];

function conversation(
  over: Partial<InboxConversation> & Pick<InboxConversation, "id" | "kind">,
): InboxConversation {
  return {
    name: null,
    is_default: false,
    created_at: "2026-01-01T00:00:00.000Z",
    member_ids: [],
    ...over,
  };
}

function message(
  over: Partial<InboxMessage> &
    Pick<InboxMessage, "conversation_id" | "created_at">,
): InboxMessage {
  return {
    user_id: SAM,
    body: "hello",
    has_attachment: false,
    ...over,
  };
}

describe("displayNameFor", () => {
  it("prefers the full name, then the email local part", () => {
    expect(displayNameFor(members[1])).toBe("Sam Diaz");
    expect(displayNameFor(members[2])).toBe("jo.baker");
    expect(displayNameFor(undefined)).toBe("Teammate");
  });
});

describe("latestByConversation", () => {
  it("keeps the newest message per conversation regardless of input order", () => {
    const latest = latestByConversation([
      message({ conversation_id: "a", created_at: "2026-03-01T10:00:00.000Z", body: "old" }),
      message({ conversation_id: "a", created_at: "2026-03-02T10:00:00.000Z", body: "new" }),
      message({ conversation_id: "b", created_at: "2026-02-01T10:00:00.000Z", body: "b1" }),
    ]);
    expect(latest.get("a")?.body).toBe("new");
    expect(latest.get("b")?.body).toBe("b1");
  });
});

describe("buildInbox", () => {
  const general = conversation({
    id: "conv-general",
    kind: "channel",
    name: "General",
    is_default: true,
    created_at: "2026-01-01T00:00:00.000Z",
  });
  const payroll = conversation({
    id: "conv-payroll",
    kind: "group",
    name: "Payroll",
    created_at: "2026-02-01T00:00:00.000Z",
    member_ids: [ME, SAM],
  });
  const dmSam = conversation({
    id: "conv-dm-sam",
    kind: "dm",
    created_at: "2026-02-15T00:00:00.000Z",
    member_ids: [ME, SAM],
  });

  function build(
    messages: InboxMessage[],
    readAt = new Map<string, string>(),
  ) {
    return buildInbox({
      conversations: [general, payroll, dmSam],
      messages,
      members,
      currentUserId: ME,
      readAt,
    });
  }

  it("titles a DM with the other person, not the conversation name", () => {
    const dm = build([]).find((r) => r.id === "conv-dm-sam");
    expect(dm?.title).toBe("Sam Diaz");
    expect(dm?.otherUserId).toBe(SAM);
  });

  it("titles groups and channels with their name and carries no other user", () => {
    const rows = build([]);
    expect(rows.find((r) => r.id === "conv-general")?.title).toBe("General");
    expect(rows.find((r) => r.id === "conv-payroll")?.title).toBe("Payroll");
    expect(rows.find((r) => r.id === "conv-payroll")?.otherUserId).toBeNull();
  });

  it("attributes the preview outside DMs and says 'You' for your own", () => {
    const rows = build([
      message({ conversation_id: "conv-payroll", created_at: "2026-03-01T09:00:00.000Z", body: "numbers are in" }),
      message({ conversation_id: "conv-dm-sam", created_at: "2026-03-01T10:00:00.000Z", user_id: ME, body: "on my way" }),
    ]);
    expect(rows.find((r) => r.id === "conv-payroll")?.preview).toBe(
      "Sam Diaz: numbers are in",
    );
    expect(rows.find((r) => r.id === "conv-dm-sam")?.preview).toBe(
      "You: on my way",
    );
  });

  it("describes an attachment-only message instead of showing an empty preview", () => {
    const rows = build([
      message({ conversation_id: "conv-dm-sam", created_at: "2026-03-01T10:00:00.000Z", body: "   ", has_attachment: true }),
    ]);
    expect(rows.find((r) => r.id === "conv-dm-sam")?.preview).toBe("Sent a file");
  });

  it("falls back to placeholder copy when nothing has been posted", () => {
    const rows = build([]);
    expect(rows.find((r) => r.id === "conv-dm-sam")?.preview).toBe(
      "No messages yet",
    );
    expect(rows.find((r) => r.id === "conv-general")?.preview).toBe(
      "Nothing posted here yet",
    );
  });

  it("orders by most recent activity, newest first", () => {
    const rows = build([
      message({ conversation_id: "conv-general", created_at: "2026-03-01T08:00:00.000Z" }),
      message({ conversation_id: "conv-dm-sam", created_at: "2026-03-05T08:00:00.000Z" }),
      message({ conversation_id: "conv-payroll", created_at: "2026-03-03T08:00:00.000Z" }),
    ]);
    expect(rows.map((r) => r.id)).toEqual([
      "conv-dm-sam",
      "conv-payroll",
      "conv-general",
    ]);
  });

  it("puts a silent but newly created group above an older silent channel", () => {
    const rows = build([]);
    expect(rows.map((r) => r.id)).toEqual([
      "conv-dm-sam",
      "conv-payroll",
      "conv-general",
    ]);
  });

  it("marks somebody else's newer message unread and your own never", () => {
    const rows = build(
      [
        message({ conversation_id: "conv-payroll", created_at: "2026-03-03T08:00:00.000Z" }),
        message({ conversation_id: "conv-dm-sam", created_at: "2026-03-05T08:00:00.000Z", user_id: ME }),
      ],
      new Map([["conv-payroll", "2026-03-01T00:00:00.000Z"]]),
    );
    expect(rows.find((r) => r.id === "conv-payroll")?.unread).toBe(true);
    expect(rows.find((r) => r.id === "conv-dm-sam")?.unread).toBe(false);
  });

  it("clears unread once the conversation has been opened since the message", () => {
    const rows = build(
      [message({ conversation_id: "conv-payroll", created_at: "2026-03-03T08:00:00.000Z" })],
      new Map([["conv-payroll", "2026-03-04T00:00:00.000Z"]]),
    );
    expect(rows.find((r) => r.id === "conv-payroll")?.unread).toBe(false);
  });

  it("never marks an empty conversation unread", () => {
    expect(build([]).every((r) => r.unread === false)).toBe(true);
  });

  it("counts the whole company for a channel and only listed members otherwise", () => {
    const rows = build([]);
    expect(rows.find((r) => r.id === "conv-general")?.memberCount).toBe(3);
    expect(rows.find((r) => r.id === "conv-payroll")?.memberCount).toBe(2);
  });

  it("truncates a long preview rather than letting it break the row", () => {
    const rows = build([
      message({
        conversation_id: "conv-dm-sam",
        created_at: "2026-03-01T10:00:00.000Z",
        body: "x".repeat(400),
      }),
    ]);
    const preview = rows.find((r) => r.id === "conv-dm-sam")?.preview ?? "";
    expect(preview.length).toBeLessThanOrEqual(90);
    expect(preview.endsWith("...")).toBe(true);
  });
});
