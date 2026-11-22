// Sends email through Scaleway Transactional Email (TEM).
// Without TEM settings (local development) the email is printed to the server log instead.
export async function sendMail({ to, subject, text }) {
  const { TEM_SECRET_KEY, TEM_PROJECT_ID, MAIL_FROM, TEM_REGION = 'fr-par' } = process.env;
  if (!TEM_SECRET_KEY || !TEM_PROJECT_ID || !MAIL_FROM) {
    console.log(`[mail not configured] to=${to} subject=${subject}\n${text}`);
    return;
  }
  const res = await fetch(`https://api.scaleway.com/transactional-email/v1alpha1/regions/${TEM_REGION}/emails`, {
    method: 'POST',
    headers: { 'X-Auth-Token': TEM_SECRET_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: { email: MAIL_FROM, name: 'Catch the leaf!' },
      to: [{ email: to }],
      subject,
      text,
      project_id: TEM_PROJECT_ID,
    }),
  });
  if (!res.ok) console.error('email failed', res.status, await res.text().catch(() => ''));
}
