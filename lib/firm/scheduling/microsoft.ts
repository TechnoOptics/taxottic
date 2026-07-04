import type {
  CalendarProvider,
  CreateMeetingInput,
  CreateMeetingResult,
} from "./provider";

// Microsoft Graph adapter, creates a Teams meeting + posts a
// Calendar event in the user's primary calendar. Two API calls:
//   1. POST /me/onlineMeetings  → returns joinWebUrl
//   2. POST /me/events          → posts the calendar invite with
//      the Teams URL embedded as `onlineMeetingProvider`
//
// Scopes: OnlineMeetings.ReadWrite + Calendars.ReadWrite.

export const microsoftProvider: CalendarProvider = {
  id: "microsoft",

  async createMeeting(
    accessToken: string,
    input: CreateMeetingInput,
  ): Promise<CreateMeetingResult> {
    if (!accessToken) return { ok: false, reason: "no_token" };
    try {
      const endIso = new Date(
        new Date(input.startsAt).getTime() + input.durationMinutes * 60_000,
      ).toISOString();

      // Step 1: mint the online meeting.
      const meetingRes = await fetch(
        "https://graph.microsoft.com/v1.0/me/onlineMeetings",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            startDateTime: input.startsAt,
            endDateTime: endIso,
            subject: input.title,
          }),
        },
      );
      if (!meetingRes.ok) {
        const txt = await meetingRes.text().catch(() => "");
        return {
          ok: false,
          reason: `ms-graph meeting ${meetingRes.status}: ${txt.slice(0, 200)}`,
        };
      }
      const meetingJson = (await meetingRes.json()) as {
        id?: string;
        joinWebUrl?: string;
      };
      if (!meetingJson.id || !meetingJson.joinWebUrl) {
        return { ok: false, reason: "ms-graph meeting missing fields" };
      }

      // Step 2: post the calendar invite. We could skip this and
      // just send the join URL by email, but a calendar invite
      // gets the meeting into the user's Outlook + has the proper
      // ICS for the attendees.
      const eventRes = await fetch(
        "https://graph.microsoft.com/v1.0/me/events",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            subject: input.title,
            body: {
              contentType: "HTML",
              content: `${input.description ?? ""}\n\nJoin: ${meetingJson.joinWebUrl}`,
            },
            start: {
              dateTime: input.startsAt,
              timeZone: input.timezone ?? "UTC",
            },
            end: {
              dateTime: endIso,
              timeZone: input.timezone ?? "UTC",
            },
            attendees: input.recipients.map((r, idx) => ({
              emailAddress: { address: r.email, name: r.name ?? r.email },
              type: idx === 0 ? "required" : "required",
            })),
            isOnlineMeeting: true,
            onlineMeetingProvider: "teamsForBusiness",
            onlineMeeting: { joinUrl: meetingJson.joinWebUrl },
          }),
        },
      );
      if (!eventRes.ok) {
        // Don't fail outright, the meeting exists, just no
        // calendar event. Surface the warning to the caller.
         
        console.warn(
          `[ms-graph] meeting created but event POST failed: ${eventRes.status}`,
        );
      }

      return {
        ok: true,
        providerEventId: meetingJson.id,
        meetingUrl: meetingJson.joinWebUrl,
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
        `https://graph.microsoft.com/v1.0/me/onlineMeetings/${encodeURIComponent(providerEventId)}`,
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
