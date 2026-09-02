import Link from "next/link";
import { signOut } from "@/app/actions";
import { LanguageToggle } from "@/components/LanguageToggle";
import { Badge, Button, ButtonLink, NavLink } from "@/components/ui";
import type { Dictionary, Locale } from "@/lib/i18n";

export type HeaderLink = { href: string; label: string };

/**
 * The one header. Guest pages and host pages render this with a different set
 * of links, so the two cannot drift apart.
 */
export function SiteHeader({
  brand,
  links,
  current,
  locale,
  t,
  navLabel,
  previewing = false,
}: {
  brand: string;
  links: HeaderLink[];
  /** Path being viewed — drives aria-current and where the language switch returns. */
  current: string;
  locale: Locale;
  t: Dictionary;
  navLabel: string;
  /** A host looking at the guest site: offer a way back, not a way out. */
  previewing?: boolean;
}) {
  return (
    <header className="border-b border-border bg-canvas/80 backdrop-blur-sm">
      {previewing ? (
        <div className="border-b border-border bg-surface-sunken">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-2">
            <Badge tone="neutral">{t.nav.previewBadge}</Badge>
          </div>
        </div>
      ) : null}
      {/*
        * Two rows on a phone — brand and language above, pages and sign-out
        * below — so the language switch sits out at the edge where a thumb
        * reaching for a page link won't catch it. One row from `sm` up.
        *
        * Placed explicitly rather than left to wrapping, so the DOM order can
        * stay the sensible one for keyboards (brand, pages, language, exit)
        * regardless of where each lands visually.
        */}
      <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2 px-5 py-3 sm:grid-cols-[auto_1fr_auto_auto] sm:py-4">
        <Link
          href={links[0]?.href ?? "/"}
          className="col-start-1 row-start-1 py-1 font-display text-lg leading-tight tracking-wide text-accent sm:text-xl"
        >
          {brand}
        </Link>

        <nav
          aria-label={navLabel}
          className="col-start-1 row-start-2 flex items-center gap-5 sm:col-start-2 sm:row-start-1 sm:justify-self-end"
        >
          {links.map((link) => (
            <NavLink key={link.href} href={link.href} active={current === link.href}>
              {link.label}
            </NavLink>
          ))}
        </nav>

        <LanguageToggle
          locale={locale}
          currentPath={current}
          className="col-start-2 row-start-1 justify-self-end sm:col-start-3"
        />

        <div className="col-start-2 row-start-2 justify-self-end sm:col-start-4 sm:row-start-1">
          {previewing ? (
            <ButtonLink href="/admin/dashboard" variant="quiet" size="sm">
              {t.nav.exitPreview}
            </ButtonLink>
          ) : (
            <form action={signOut}>
              <Button type="submit" variant="quiet" size="sm">
                {t.nav.signOut}
              </Button>
            </form>
          )}
        </div>
      </div>
    </header>
  );
}

export function GuestHeader({
  current,
  babyName,
  locale,
  t,
  previewing = false,
  photos = false,
}: {
  current: string;
  babyName: string;
  locale: Locale;
  t: Dictionary;
  previewing?: boolean;
  /** The photo wall is open, so it gets a tab. See lib/photo-wall.ts. */
  photos?: boolean;
}) {
  return (
    <SiteHeader
      brand={babyName}
      current={current}
      locale={locale}
      t={t}
      previewing={previewing}
      navLabel={t.nav.primary}
      links={[
        { href: "/invitation", label: t.nav.invitation },
        { href: "/rsvp", label: t.nav.rsvp },
        { href: "/registry", label: t.nav.registry },
        ...(photos ? [{ href: "/photos", label: t.nav.photos }] : []),
      ]}
    />
  );
}

export function AdminHeader({
  current,
  babyName,
  locale,
  t,
}: {
  current: string;
  babyName: string;
  locale: Locale;
  t: Dictionary;
}) {
  return (
    <SiteHeader
      brand={babyName}
      current={current}
      locale={locale}
      t={t}
      navLabel={t.nav.hostArea}
      links={[
        { href: "/admin/dashboard", label: t.admin.dashboardShort },
        { href: "/admin/photos", label: t.nav.photos },
        { href: "/admin/settings", label: t.admin.settings },
        { href: "/invitation", label: t.admin.viewSite },
      ]}
    />
  );
}
