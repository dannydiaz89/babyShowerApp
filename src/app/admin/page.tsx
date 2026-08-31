import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminLogin } from "../actions";
import { PasswordForm } from "@/components/PasswordForm";
import { LanguageToggle } from "@/components/LanguageToggle";
import { Card, DisplayTitle } from "@/components/ui";
import { ADMIN_COOKIE, verifyToken } from "@/lib/auth";
import { getTranslation } from "@/lib/i18n";

export default async function AdminLoginPage() {
  if (await verifyToken((await cookies()).get(ADMIN_COOKIE)?.value, "admin")) {
    redirect("/admin/dashboard");
  }

  const { locale, t } = await getTranslation();

  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center px-5 py-12">
      <Card className="w-full max-w-sm px-7 py-9">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.28em] text-ink-muted">
          {t.admin.hostsOnly}
        </p>
        <DisplayTitle className="mt-2 text-center text-3xl">
          {t.admin.dashboard}
        </DisplayTitle>
        <p className="mt-2 mb-7 text-center text-sm text-ink-muted">{t.admin.signInNote}</p>

        <PasswordForm
          action={adminLogin}
          label={t.admin.signIn}
          pendingLabel={t.gate.checking}
          fieldLabel={t.gate.passwordLabel}
          placeholder={t.admin.passwordPlaceholder}
          errorPrefix={t.common.errorPrefix}
        />
      </Card>

      <div className="mt-6 flex flex-col items-center gap-4">
        <LanguageToggle locale={locale} currentPath="/admin" />
        <Link href="/" className="text-xs text-ink-muted transition-colors hover:text-ink">
          {t.admin.backToInvitation}
        </Link>
      </div>
    </main>
  );
}
