# Проверка вёрстки на демо-сборке: вылезание за экран, обрезанный текст, переносы коротких подписей, наложения.
# Запуск: DEMO_DIR=путь/к/демо python3 tests/ui/layout_audit.py 390,820,1366 1,0   (второй аргумент: 1 — продавец, 0 — владелец)
import os
import asyncio,subprocess,json,re,sys
from playwright.async_api import async_playwright
PORT=8811
srv=subprocess.Popen(['python3','-m','http.server',str(PORT),'-b','127.0.0.1','-d',os.environ.get('DEMO_DIR','demo')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
SUF=re.search(r'fakeme_(\d+)',open('/home/claude/demo/js/vendor/supabase.js').read()).group(1)
import os
JS=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'layout-audit.js')).read()
F="(a=>a&&a.id)"
MOD=[("newRepair",""),("openRepair","S.repairs.find(r=>r.status==='work').id"),("openRepair","S.repairs.find(r=>r.status==='ready').id"),("openRepair","S.repairs.find(r=>r.status==='approve').id"),
 ("repIssue","S.repairs.find(r=>r.status==='ready').id"),("repPay","S.repairs[0].id"),("repCancel","S.repairs[0].id"),("repCheck","S.repairs[0].id"),("repMsg","S.repairs[0].id"),("repLink","S.repairs.find(r=>r.status==='approve').id"),("rqNew","S.repairs[0].id"),("mpOpen",""),
 ("posPay",""),("cashMove","'in'"),("cashMove","'out'"),("closeShift",""),("openSale","S.sales[0].id"),("returnDlg","S.sales[0].id"),("posCustom",""),
 ("openClient","S.customers[0].id"),("editClient","S.customers[0].id"),("mergeDlg","S.customers[0].id"),("waitNew","S.customers[0].id"),
 ("openProduct","S.products[0].id"),("openProduct","S.products.find(p=>p.trackSerial).id"),("prodReqDel","S.products[0].id"),
 ("pzNew",""),("pzOpen","S.preorders[0].id"),("pzEdit","S.preorders[0].id"),("pzPay","S.preorders[0].id"),("pzCancel","S.preorders[0].id"),("pzSell","(S.preorders.find(p=>p.status==='arrived')||S.preorders[0]).id"),
 ("taskNew",""),("lostNew",""),("dealNew",""),("dealsList",""),("debtNew",""),("finOp","'out'"),("accForm",""),("fcatForm",""),("finPlan",""),
 ("openDoc","S.docs[0].id"),("rcvNewItem",""),("rcvSupNew",""),("exportDlg",""),("importDlg",""),("catalogNew",""),("modelForm",""),("catForm",""),("pointForm",""),("whForm",""),("svcForm",""),("supForm",""),("staffNew",""),("profile",""),("bonusHist","S.customers[0].id"),("openSO","(S.siteorders[0]||{}).id"),("spImport",""),("bankImport",""),("showDups",""),("anBuy","")]
def initjs(seller):
  return f"sessionStorage.setItem('fakeusers_{SUF}',JSON.stringify({{st2:{{email:'olga@example.com',pw:'x',name:'Ольга Смирнова (демо)'}}}}));" if seller else ""
async def run(W,seller):
  async with async_playwright() as p:
    b=await p.chromium.launch();m=W<500
    ctx=await b.new_context(viewport={'width':W,'height':(844 if m else 900)},is_mobile=m,has_touch=m,service_workers='block')
    if seller: await ctx.add_init_script(initjs(1))
    pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
    url=f'http://127.0.0.1:{PORT}/index.html'+('' if seller else '?ws=crm')
    await pg.goto(url);await pg.wait_for_timeout(1500)
    if seller:
      await pg.evaluate("App.sb.auth.signInWithPassword({email:'olga@example.com',password:'x'})");await pg.wait_for_timeout(200);await pg.goto(url);await pg.wait_for_timeout(1800)
    who='seller' if seller else 'owner'
    views=await pg.evaluate("App.NAV.filter(n=>!n[3]||App.can(n[3])).map(n=>n[0])")
    for v in views:
      await pg.evaluate(f"App.closeModal&&App.closeModal();location.hash='{v}'");await pg.wait_for_timeout(450)
      r=await pg.evaluate(JS)
      if r:print(f"{W} {who} VIEW {v}: "+json.dumps(r,ensure_ascii=False))
    for a,arg in MOD:
      ok=await pg.evaluate(f"(()=>{{try{{const S=App.S;App.closeModal();document.getElementById('prv')?.remove();if(!App.ACT['{a}'])return 'noact';App.ACT['{a}']({arg or ''});return 'ok'}}catch(e){{return 'ERR '+e.message}}}})()")
      if ok!='ok':continue
      await pg.wait_for_timeout(450)
      await pg.evaluate("window.__wantModal=1");r=await pg.evaluate(JS);await pg.evaluate("window.__wantModal=0")
      if r==['NO-MODAL']:continue
      if r:print(f"{W} {who} MODAL {a}({arg[:30]}): "+json.dumps(r,ensure_ascii=False))
    if errs:print(W,who,'pageerrors',errs[:5])
    await b.close()
async def main():
  for W in [int(x) for x in sys.argv[1].split(',')]:
    for s in [int(x) for x in sys.argv[2].split(',')]:
      await run(W,s)
asyncio.run(main());srv.terminate()
