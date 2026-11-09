// Управление сотрудниками для владельца: приглашение, создание с временным паролем, сброс пароля,
// ссылка для входа, блокировка, смена email, список с последним входом. Вызывается из CRM с токеном владельца.
export type Admin = {
  inviteUserByEmail(email: string, o: any): Promise<{ data: any; error: any }>;
  createUser(o: any): Promise<{ data: any; error: any }>;
  generateLink(o: any): Promise<{ data: any; error: any }>;
  updateUserById(id: string, o: any): Promise<{ data: any; error: any }>;
  getUserById(id: string): Promise<{ data: any; error: any }>;
  listUsers(o: any): Promise<{ data: any; error: any }>;
};
export type Db = {
  staff(id: string): Promise<any | null>;
  staffList(): Promise<any[]>;
  insertStaff(row: Record<string, unknown>): Promise<void>;
  mark(id: string, patch: Record<string, unknown>): Promise<void>;
  audit(by: string, action: string, ref: string, details?: string): Promise<void>;
  sendRecovery(email: string, redirectTo: string): Promise<void>;
  removeRequest(id: string): Promise<void>;
};
export const ROLES = ["manager", "seller", "master", "storekeeper"];
const NEED_POINT = ["seller", "master", "storekeeper"];
const RU: Record<string, string> = { manager: "Управляющий", seller: "Продавец", master: "Мастер", storekeeper: "Кладовщик" };
const okEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const okRedirect = (u: string) => /^https:\/\//.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u);
const fail = (msg: string, status = 400) => ({ status, body: { error: msg } });
const done = (body: any) => ({ status: 200, body });
const tr = (e: any) => {
  const m = String(e?.message || e || "");
  if (/already been registered|already registered|exists/i.test(m)) return "Пользователь с таким email уже зарегистрирован";
  if (/rate limit/i.test(m)) return "Слишком много писем за короткое время — попробуйте позже или используйте «Ссылку для входа»";
  if (/password/i.test(m) && /least|short|weak/i.test(m)) return "Слишком простой пароль: минимум 8 символов";
  return m || "Ошибка";
};

export async function run(callerId: string, body: any, admin: Admin, db: Db): Promise<{ status: number; body: any }> {
  const me = await db.staff(callerId);
  if (!me || !me.is_active || me.role !== "owner") return fail("Управлять сотрудниками может только владелец", 403);
  const a = String(body?.action || "");
  const redirect = String(body?.redirect || "");
  if (["invite", "reset_email", "reset_link"].includes(a) && !okRedirect(redirect)) return fail("Некорректный адрес возврата");

  if (a === "list") {
    const staff = await db.staffList(); const out: any[] = [];
    for (const s of staff) {
      const { data } = await admin.getUserById(s.id);
      const u = data?.user;
      out.push({ id: s.id, email: u?.email || s.email || null, last_sign_in_at: u?.last_sign_in_at || null, confirmed: !!u?.email_confirmed_at,
        invited: !!u?.invited_at && !u?.last_sign_in_at, banned: !!u?.banned_until && new Date(u.banned_until) > new Date() });
    }
    return done({ users: out });
  }

  if (a === "invite" || a === "create") {
    const email = String(body.email || "").trim().toLowerCase(), name = String(body.full_name || "").trim(), role = String(body.role || "");
    const point = body.point_id || null, phone = String(body.phone || "").trim() || null;
    if (!okEmail(email)) return fail("Укажите правильный email");
    if (!name) return fail("Укажите имя сотрудника");
    if (!ROLES.includes(role)) return fail("Выберите роль");
    if (NEED_POINT.includes(role) && !point) return fail("Для этой роли выберите точку");
    let user: any;
    if (a === "invite") {
      const r = await admin.inviteUserByEmail(email, { data: { full_name: name }, redirectTo: redirect });
      if (r.error) return fail(tr(r.error));
      user = r.data?.user;
    } else {
      const pw = String(body.password || "");
      if (pw.length < 8) return fail("Временный пароль — минимум 8 символов");
      const r = await admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: name } });
      if (r.error) return fail(tr(r.error));
      user = r.data?.user;
    }
    if (!user?.id) return fail("Не удалось создать пользователя");
    await db.insertStaff({ id: user.id, full_name: name, role, point_id: point, phone, email, must_change_password: a === "create" });
    await db.removeRequest(user.id);
    await db.audit(callerId, a === "invite" ? "Приглашён сотрудник" : "Создан сотрудник", name, `${RU[role]} · ${email}`);
    return done({ ok: true, id: user.id });
  }

  // действия над существующим сотрудником
  const t = await db.staff(String(body.id || ""));
  if (!t) return fail("Сотрудник не найден", 404);
  const { data: ud } = await admin.getUserById(t.id);
  const email = ud?.user?.email || t.email;
  const isOwner = t.role === "owner";

  if (a === "reset_email") {
    if (!email) return fail("У сотрудника нет email");
    try { await db.sendRecovery(email, redirect); } catch (e) { return fail(tr(e)); }
    await db.audit(callerId, "Отправлена ссылка смены пароля", t.full_name, email);
    return done({ ok: true, email });
  }
  if (a === "reset_link") {
    if (!email) return fail("У сотрудника нет email");
    const r = await admin.generateLink({ type: "recovery", email, options: { redirectTo: redirect } });
    if (r.error) return fail(tr(r.error));
    await db.audit(callerId, "Создана ссылка для входа", t.full_name, "");
    return done({ ok: true, link: r.data?.properties?.action_link || r.data?.action_link });
  }
  if (a === "set_password") {
    if (t.id === callerId) return fail("Свой пароль меняйте в профиле");
    const pw = String(body.password || "");
    if (pw.length < 8) return fail("Временный пароль — минимум 8 символов");
    const r = await admin.updateUserById(t.id, { password: pw });
    if (r.error) return fail(tr(r.error));
    await db.mark(t.id, { must_change_password: true });
    await db.audit(callerId, "Задан временный пароль", t.full_name, "");
    return done({ ok: true });
  }
  if (a === "block" || a === "unblock") {
    if (t.id === callerId || isOwner) return fail("Владельца заблокировать нельзя");
    const r = await admin.updateUserById(t.id, { ban_duration: a === "block" ? "876000h" : "none" });
    if (r.error) return fail(tr(r.error));
    await db.mark(t.id, { is_active: a === "unblock" });
    await db.audit(callerId, a === "block" ? "Сотрудник заблокирован" : "Сотрудник разблокирован", t.full_name, "");
    return done({ ok: true });
  }
  if (a === "change_email") {
    const ne = String(body.email || "").trim().toLowerCase();
    if (!okEmail(ne)) return fail("Укажите правильный email");
    if (t.id === callerId) return fail("Свой email меняйте в профиле");
    const r = await admin.updateUserById(t.id, { email: ne, email_confirm: true });
    if (r.error) return fail(tr(r.error));
    await db.mark(t.id, { email: ne });
    await db.audit(callerId, "Изменён email сотрудника", t.full_name, `${email} → ${ne}`);
    return done({ ok: true });
  }
  return fail("Неизвестное действие");
}
