import type {
  CalendarProvider,
  CreateMeetingInput,
  CreateMeetingResult,
} from "./provider";

// Google Calendar adapter. POST /calendar/v3/calendars/primary/events
// with `conferenceData.createRequest` instructs Calendar to mint a
// Google Meet link. OAuth scope: calendar.events.
//
// `conferenceDataVersion=1` query param is required to actually
// get the Meet link back; without it the field is silently dropped.

export const googleProvider: CalendarProvider = {
  id: "google",

  async createMeeting(
    accessToken: string,
    input: CreateMeetingInput,
  ): Promise<CreateMeetingResult> {
    if (!accessToken) return { ok: false, reason: "no_token" };
    try {
      const endIso = new Date(
        new Date(input.startsAt).getTime() + input.durationMinutes * 60_000,
      ).toISOString();
      const body = {
        summary: input.title,
        description: input.description ?? "",
        start: { dateTime: input.startsAt, timeZone: input.timezone ?? "UTC" },
        end: { dateTime: endIso, timeZone: input.timezone ?? "UTC" },
        attendees: input.recipients.map((r) => ({
          email: r.email,
          displayName: r.name,
        })),
        conferenceData: {
          createRequest: {
            requestId: cryptoRandomId(),
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
        guestsCanInviteOthers: false,
        guestsCanModify: false,
        guestsCanSeeOtherGuests: true,
      };
      const url =
        "https://www.googleapis.com/calendar/v3/calendars/primary/events" +
        "?conferenceDataVersion=1&sendUpdates=all";
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        return { ok: false, reason: `google ${res.status}: ${txt.slice(0, 200)}` };
      }
      const json = (await res.json()) as {
        id?: string;
        hangoutLink?: string;
        conferenceData?: { entryPoints?: { uri?: string }[] };
      };
      const meetingUrl =
        json.hangoutLink ??
        json.conferenceData?.entryPoints?.[0]?.uri ??
        undefined;
      if (!json.id || !meetingUrl) {
        return { ok: false, reason: "google response missing fields" };
      }
      return {
        ok: true,
        providerEventId: json.id,
        meetingUrl,
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
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(providerEventId)}?sendUpdates=all`,
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

function cryptoRandomId(): string {
  // crypto.randomUUID is in the global namespace on Node 20+ and Edge.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}
