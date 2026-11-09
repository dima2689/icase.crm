// Проверка staff-admin на поддельном Auth и базе. Запуск: deno run supabase/functions/tests/staff_admin_test.ts
import { run, type Admin, type Db } from "../staff-admin/handler.ts";
const users = new Map<string, any>(); const staff = new Map<string, any>(); const log: string[] = []; const mails: string[] = [];
let n = 0; const id = () => "u" + (++n);
users.set("own", { id: "own", email: "owner@x.ru", email_confirmed_at: "x", last_sign_in_at: "2026-11-09" });
staff.set("own", { id: "own", full_name: "Владелец", role: "owner", is_active: true, email: "owner@x.ru" });
const admin: Admin = {
  async inviteUserByEmail(email, o) { if ([...users.values()].some((u) => u.email === email)) return { data: null, error: { message: "A user with this email address has already been registered" } }; const u = { id: id(), email, invited_at: "now", meta: o.data }; users.set(u.id, u); mails.push("invite:" + email + ":" + o.redirectTo); return { data: { user: u }, error: null }; },
  async createUser(o) { if ([...users.values()].some((u) => u.email === o.email)) return { data: null, error: { message: "already been registered" } }; const u = { id: id(), email: o.email, password: o.password, email_confirmed_at: "now" }; users.set(u.id, u); return { data: { user: u }, error: null }; },
  async generateLink(o) { return { data: { properties: { action_link: "https://auth/verify?type=recovery&email=" + o.email } }, error: null }; },
  async updateUserById(i, o) { const u = users.get(i); Object.assign(u, o.ban_duration ? { banned_until: o.ban_duration === "none" ? null : "2126-01-01" } : o); return { data: { user: u }, error: null }; },
  async getUserById(i) { return { data: { user: users.get(i) }, error: null }; },
  async listUsers() { return { data: { users: [...users.values()] }, error: null }; },
};
const db: Db = {
  async staff(i) { return staff.get(i) || null; }, async staffList() { return [...staff.values()]; },
  async insertStaff(r) { staff.set(String(r.id), { ...r, is_active: true }); }, async mark(i, p) { const s = staff.get(i); if (p.is_active !== undefined) s.is_active = p.is_active; if (p.must_change_password !== undefined) s.must_change_password = p.must_change_password; if (p.email) s.email = p.email; },
  async audit(_b, a, r) { log.push(a + ":" + r); }, async sendRecovery(e, r) { mails.push("reset:" + e + ":" + r); }, async removeRequest() {},
};
let fails = 0; const ok = (c: unknown, m: string) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails++; };
const R = "https://crm.icase.ru/";
ok((await run("own", { action: "invite", email: "a@x.ru", full_name: "Анна", role: "seller", redirect: R }, admin, db)).status === 400, "продавцу без точки — отказ");
let r = await run("own", { action: "invite", email: "a@x.ru", full_name: "Анна", role: "seller", point_id: "p1", redirect: R }, admin, db);
ok(r.status === 200 && mails.includes("invite:a@x.ru:" + R), "приглашение отправлено на email");
const anna = r.body.id;
ok((await run("own", { action: "invite", email: "a@x.ru", full_name: "Анна", role: "seller", point_id: "p1", redirect: R }, admin, db)).body.error.includes("уже зарегистрирован"), "повторное приглашение — понятная ошибка");
r = await run("own", { action: "create", email: "b@x.ru", full_name: "Борис", role: "master", point_id: "p1", password: "123" }, admin, db);
ok(r.status === 400, "короткий временный пароль — отказ");
r = await run("own", { action: "create", email: "b@x.ru", full_name: "Борис", role: "master", point_id: "p1", password: "Temp-2026!" }, admin, db);
const boris = r.body.id;
ok(r.status === 200 && staff.get(boris).must_change_password === true, "создан с временным паролем, при входе попросит сменить");
ok((await run(anna, { action: "list" }, admin, db)).status === 403, "не владелец — нет доступа");
r = await run("own", { action: "list" }, admin, db);
ok(r.body.users.length === 3 && r.body.users.find((u: any) => u.id === anna).invited, "список: приглашение ещё не принято");
r = await run("own", { action: "reset_email", id: anna, redirect: R }, admin, db); ok(r.status === 200 && mails.includes("reset:a@x.ru:" + R), "письмо для смены пароля");
r = await run("own", { action: "reset_link", id: anna, redirect: R }, admin, db); ok(r.body.link && r.body.link.includes("recovery"), "ссылка для входа (можно отправить в мессенджер)");
ok((await run("own", { action: "reset_link", id: anna, redirect: "javascript:alert(1)" }, admin, db)).status === 400, "чужой адрес возврата — отказ");
r = await run("own", { action: "set_password", id: anna, password: "Novyi-parol-1" }, admin, db); ok(r.status === 200 && users.get(anna).password === "Novyi-parol-1" && staff.get(anna).must_change_password, "владелец задал временный пароль");
r = await run("own", { action: "block", id: anna }, admin, db); ok(r.status === 200 && users.get(anna).banned_until && staff.get(anna).is_active === false, "блокировка: вход закрыт, сеансы недействительны");
r = await run("own", { action: "list" }, admin, db); ok(r.body.users.find((u: any) => u.id === anna).banned, "в списке видно, что заблокирован");
r = await run("own", { action: "unblock", id: anna }, admin, db); ok(!users.get(anna).banned_until && staff.get(anna).is_active, "разблокировка");
ok((await run("own", { action: "block", id: "own" }, admin, db)).status === 400, "себя/владельца заблокировать нельзя");
r = await run("own", { action: "change_email", id: anna, email: "anna@x.ru" }, admin, db); ok(r.status === 200 && users.get(anna).email === "anna@x.ru", "смена email");
ok(log.length >= 7, "все действия записаны в журнал");
console.log(fails ? "ОШИБОК: " + fails : "ВСЁ ПРОШЛО"); Deno.exit(fails ? 1 : 0);
