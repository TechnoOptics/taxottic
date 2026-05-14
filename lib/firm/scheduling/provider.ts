// Calendar / meeting-provider abstraction.
//
// Three concrete providers (google, microsoft, zoom). Each one
// handles two operations:
//
//   1. createMeeting: generate a meeting URL + provider event ID
//      from a {title, starts_at, duration, recipients} payload.
//   2. cancelMeeting: void / cancel an upcoming event.
//
// The interface is intentionally THIN. Real calendar UX (free/busy
// queries, recurring events, attendee status, RSVPs) sits in the
// provider-specific code paths because each calendar's data model
// diverges enough that a fat abstraction would leak.

export type MeetingRecipient = {
  email: string;
  name?: string;
};

export type CreateMeetingInput = {
  /** Title shown on the calendar event. */
  title: string;
  /** Optional description / agenda. */
  description?: string;
  /** ISO-8601 start time. */
  startsAt: string;
  /** Duration in minutes. */
  durationMinutes: number;
  /** Organizer + attendees. The first recipient is the host. */
  recipients: MeetingRecipient[];
  /** Time zone hint (IANA, e.g., "America/New_York"). The provider
   *  uses this to format the human-readable invite. */
  timezone?: string;
};

export type CreateMeetingResult = {
  ok: boolean;
  /** Provider's stable event ID. */
  providerEventId?: string;
  /** Joinable URL (Zoom / Teams / Meet). */
  meetingUrl?: string;
  reason?: string;
};

export interface CalendarProvider {
  readonly id: "google" | "microsoft" | "zoom";
  createMeeting(
    accessToken: string,
    input: CreateMeetingInput,
  ): Promise<CreateMeetingResult>;
  cancelMeeting(accessToken: string, providerEventId: string): Promise<boolean>;
}

/**
 * Picks the first provider for which the current user has a
 * connected integration. Used by the meeting-create action when
 * the firm hasn't pinned a preferred provider. Falls back to
 * "manual" (no provider event; preparer enters the URL themselves)
 * when nothing's connected.
 */
export type FirmCalendarProviderId = CalendarProvider["id"];

export async function loadCalendarProvider(
  id: FirmCalendarProviderId,
): Promise<CalendarProvider | null> {
  switch (id) {
    case "zoom": {
      const { zoomProvider } = await import("./zoom");
      return zoomProvider;
    }
    case "google": {
      const { googleProvider } = await import("./google");
      return googleProvider;
    }
    case "microsoft": {
      const { microsoftProvider } = await import("./microsoft");
      return microsoftProvider;
    }
    default:
      return null;
  }
}
