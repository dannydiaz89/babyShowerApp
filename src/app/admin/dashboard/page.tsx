import { api } from "../../../../convex/_generated/api";
import { signOut } from "@/app/actions";
import { AdminHeader } from "@/components/SiteHeader";
import { RsvpTable } from "@/components/RsvpTable";
import {
  AnchorButton,
  Button,
  Card,
  Eyebrow,
  Overline,
  PageTitle,
  StatGroup,
} from "@/components/ui";
import { convexClient, convexKey } from "@/lib/convex";
import { getTranslation, fill, pick, formatDate } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";
import type { Dictionary } from "@/lib/i18n";

// RSVPs change while the page is open; never serve this from a cache.
export const dynamic = "force-dynamic";

function loadStats() {
  return convexClient().query(api.rsvps.stats, { key: convexKey() });
}

function loadList() {
  return convexClient().query(api.rsvps.list, { key: convexKey() });
}

/** Shown when Convex isn't wired up yet, instead of a bare 500. */
function SetupNeeded({ detail, t }: { detail: string; t: Dictionary }) {
  return (
    <main id="main" className="mx-auto max-w-xl px-5 py-20">
      <Card className="px-7 py-9">
        <PageTitle className="text-3xl">The database isn&rsquo;t connected yet</PageTitle>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          The site works, but RSVPs have nowhere to go. Finish the Convex setup:
        </p>
        <ol className="mt-5 space-y-2 text-sm text-ink">
          <li>
            1. Run <code className="rounded-xs bg-surface-sunken px-1.5 py-0.5">pnpm convex</code>{" "}
            and follow the prompts.
          </li>
          <li>
            2. Copy the deployment URL into{" "}
            <code className="rounded-xs bg-surface-sunken px-1.5 py-0.5">CONVEX_URL</code> in{" "}
            <code className="rounded-xs bg-surface-sunken px-1.5 py-0.5">.env.local</code>.
          </li>
          <li>
            3. Run{" "}
            <code className="rounded-xs bg-surface-sunken px-1.5 py-0.5">
              pnpm exec convex env set ADMIN_API_KEY &lt;your key&gt;
            </code>{" "}
            with the same value.
          </li>
        </ol>
        <p className="mt-6 rounded-md bg-surface-sunken px-3 py-2 font-mono text-xs text-ink-muted">
          {detail}
        </p>
        <form action={signOut} className="mt-6">
          <Button type="submit" variant="secondary">
            {t.nav.signOut}
          </Button>
        </form>
      </Card>
    </main>
  );
}

export default async function DashboardPage() {
  const { locale, t } = await getTranslation();

  let stats: Awaited<ReturnType<typeof loadStats>>;
  let rsvps: Awaited<ReturnType<typeof loadList>>;
  let settings: Awaited<ReturnType<typeof getSettings>>;

  try {
    [stats, rsvps, settings] = await Promise.all([loadStats(), loadList(), getSettings()]);
  } catch (error) {
    return <SetupNeeded detail={error instanceof Error ? error.message : String(error)} t={t} />;
  }

  const meals = Object.entries(stats.mealCounts).sort((a, b) => b[1] - a[1]);

  /*
   * Dates are rendered to text here, on the server, and handed to the table as
   * strings. Formatting them inside the client component would use the
   * server's time zone during SSR and the visitor's during hydration — two
   * different strings for the same row, which React reports as a mismatch.
   */
  const short = (ms: number) =>
    new Date(ms).toLocaleDateString(locale === "es" ? "es-MX" : "en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const rows = rsvps.map((rsvp) => ({
    ...rsvp,
    receivedLabel: short(rsvp.submittedAt),
    editedLabel:
      rsvp.updatedAt > rsvp.submittedAt
        ? fill(t.admin.edited, { date: short(rsvp.updatedAt) })
        : null,
  }));
  return (
    <>
      <AdminHeader
        current="/admin/dashboard"
        babyName={settings.babyName}
        locale={locale}
        t={t}
      />

      <main id="main" className="mx-auto max-w-6xl px-5 pb-20 pt-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>{formatDate(settings.startISO, locale)}</Eyebrow>
            <PageTitle className="mt-2">{t.admin.dashboard}</PageTitle>
          </div>
          {/* An action, not a destination — so it sits with the data, not the nav. */}
          <AnchorButton href="/admin/export">{t.admin.downloadCsv}</AnchorButton>
        </div>

        <section aria-label={t.admin.responses} className="grid gap-3 sm:grid-cols-2">
          {/* How many people to cater for. */}
          <StatGroup
            label={t.admin.groupGuests}
            items={[
              { label: t.admin.total, value: stats.totalGuests },
              { label: t.admin.adults, value: stats.adults },
              { label: t.admin.children, value: stats.kids },
            ]}
          />
          {/* How many replies those people came from. */}
          <StatGroup
            label={t.admin.groupParties}
            items={[
              { label: t.admin.responses, value: stats.responses },
              { label: t.admin.attending, value: stats.attendingParties },
              { label: t.admin.declined, value: stats.decliningParties },
            ]}
          />
        </section>

        {meals.length > 0 || stats.withDietaryNotes > 0 ? (
          <Card as="section" className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-3 px-6 py-5">
            <Overline as="h2">{t.admin.catering}</Overline>
            {meals.map(([meal, n]) => (
              <p key={meal} className="text-sm text-ink">
                <span className="font-display text-xl tabular-nums">{n}</span>{" "}
                <span className="text-ink-muted">{meal}</span>
              </p>
            ))}
            {stats.withDietaryNotes > 0 ? (
              <p className="text-sm text-danger">
                {fill(t.admin.allergyNote, { count: stats.withDietaryNotes })}
              </p>
            ) : null}
          </Card>
        ) : null}

        <section className="mt-6">
          <RsvpTable
            rsvps={rows}
            t={t}
            askMeal={settings.askMeal}
            mealOptions={settings.mealOptions.map((option) => pick(option, locale))}
          />
        </section>
      </main>
    </>
  );
}
