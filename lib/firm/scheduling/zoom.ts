import type {
  CalendarProvider,
  CreateMeetingInput,
  CreateMeetingResult,
} from "./provider";

// Zoom adapter. POST /v2/users/me/meetings with the user's OAuth
// token mints a meeting + join URL. The token must carry the
// `meeting:write` scope (granted during the OAuth handshake in
// /app/api/oauth/zoom/*, not in this commit; see runbook).

export const zoomProvider: CalendarProvider = {
  id: "zoom",

  async createMeeting(
    accessToken: string,
    input: CreateMeetingInput,
  ): Promise<CreateMeetingResult> {
    if (!accessToken) {
      return { ok: false, reason: "no_token" };
    }
    try {
      const body = {
        topic: input.title,
        type: 2, // scheduled meeting
        start_time: input.startsAt,
        duration: input.durationMinutes,
        timezone: input.timezone ?? "UTC",
        agenda: input.description ?? "",
        settings: {
          join_before_host: true,
          waiting_room: false,
          host_video: true,
          participant_video: true,
          meeting_invitees: input.recipients
            .filter((r, idx) => idx > 0) // skip host
            .map((r) => ({ email: r.email })),
        },
      };
      const res = await fetch("https://api.zoom.us/v2/users/me/meetings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        return { ok: false, reason: `zoom ${res.status}: ${txt.slice(0, 200)}` };
      }
      const json = (await res.json()) as {
        id?: number | string;
        join_url?: string;
      };
      if (!json.join_url || !json.id) {
        return { ok: false, reason: "zoom response missing fields" };
      }
      return {
        ok: true,
        providerEventId: String(json.id),
        meetingUrl: json.join_url,
      };
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : "unknown",
      };
    }
  },

  async cancelMeeting(
    accessToken: string,
    providerEventId: string,
  ): Promise<boolean> {
    if (!accessToken) return false;
    try {
      const res = await fetch(
        `https://api.zoom.us/v2/meetings/${encodeURIComponent(providerEventId)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      return res.ok;
    } catch {
      return false;
    }
  },
};
