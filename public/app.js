(() => {
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const usdCents = cents => '$' + (cents / 100).toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2});
const usd = n => usdCents(Math.round(Number(n) * 100));
const integer = n => Number(n || 0).toLocaleString('en-US');
const labels = {pending:'Pending',processing:'Processing',completed:'Completed',cancelled:'Cancelled'};
const api = async (path, method='GET', data) => {
  const response = await fetch('/api'+path, {method, headers:{'Content-Type':'application/json'}, ...(data === undefined ? {} : {body:JSON.stringify(data)})});
  let result;
  try {result=await response.json();}catch {throw new Error('Unable to contact the database server. Launch the app using python server.py.');}
  if(!response.ok)throw new Error(result.error || `Server error ${response.status}`);
  return result;
};
let orders=[], editingUid=null, currentView='all', filterStatus='all', searchTerm='';
let image='';
let globalPriceCents=325;
let toastTimer;
function notify(text){const t=$('toast');t.textContent=text;t.style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.style.display='none',3000);}
function visibleOrders(){return orders.filter(o=> (currentView==='all'||o.status===currentView) && (filterStatus==='all'||o.status===filterStatus) && (!searchTerm||[o.id,o.buyer,o.notes,o.product].join(' ').toLowerCase().includes(searchTerm)));}
function render(){
  const active=orders.filter(o=>['pending','processing'].includes(o.status));
  $('pendingCount').textContent=integer(active.length);
  $('keysCount').textContent=integer(active.reduce((s,o)=>s+o.remaining,0));
  $('pendingValue').textContent=usdCents(active.reduce((s,o)=>s+o.remaining*o.price_cents,0));
  $('completedCount').textContent=integer(orders.filter(o=>o.status==='completed').length);
  $('suppliedCount').textContent=integer(orders.reduce((s,o)=>s+o.supplied,0));
  const shown=visibleOrders();
  $('footerCount').textContent=`Showing ${shown.length} of ${orders.length} orders`;
  $('rows').innerHTML=shown.map(o=>`<tr>
    <td class="checkbox"><span class="chk"></span></td>
    <td><span class="id-cell">${esc(o.buyer)}</span></td>
    <td><span class="status-pill ${o.status}">${labels[o.status]}</span></td>
    <td><div class="product-cell"><img class="product-thumb" src="${image}" alt="Key"><div><div class="product-name">${esc(o.product)}</div><div class="product-sub">Order for key supply</div></div></div></td>
    <td class="money">${integer(o.quantity)}</td>
    <td>${integer(o.supplied)}</td><td>${integer(o.remaining)}</td>
    <td class="money">${usdCents(o.price_cents)}</td>
    <td class="total-strong">${usdCents(o.quantity*o.price_cents)}</td>
    <td>${esc(o.id)}</td>
    <td><div class="actions">
    <button class="mini-btn primary" data-action="supply" data-id="${esc(o.uid)}" ${o.remaining<=0||['completed','cancelled'].includes(o.status)?'disabled':''}>Supply</button>
    <button class="mini-btn" data-action="edit" data-id="${esc(o.uid)}">Edit</button>
    <button class="mini-btn danger" data-action="delete" data-id="${esc(o.uid)}">Delete</button>
    </div></td></tr>`).join('');
  $('empty').style.display=shown.length?'none':'block';
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.view===currentView));
}
async function reload(){orders=await api('/orders');render();}
function openModal(uid=null){
  editingUid=uid;
  const o=orders.find(x=>x.uid===uid);
  $('modalTitle').textContent=o?'Edit Order':'New Order';
  $('saveBtn').textContent=o?'Save Changes':'Save Order';
  $('orderId').value=o?.id??'';$('buyer').value=o?.buyer??'';
  $('quantity').value=o?.quantity??'';$('price').value=(globalPriceCents/100).toFixed(2);
  $('status').value=o?.status??'pending';
  $('product').value=o?.product??'Mann Co. Supply Crate Key';$('notes').value=o?.notes??'';
  $('modalOverlay').classList.add('open');$('orderId').focus();
}
function closeModal(){$('modalOverlay').classList.remove('open');editingUid=null;}
function download(name, content, mime){const blob=new Blob([content],{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportCSV(){const headers=['Order No','Customer ID','Status','Product','Amount','Supplied','Remaining','Unit Price USD','Total USD','Notes'];
 const rows=orders.map(o=>[o.id,o.buyer,labels[o.status],o.product,o.quantity,o.supplied,o.remaining,o.price.toFixed(2),(o.quantity*o.price_cents/100).toFixed(2),o.notes]);
 const csv=[headers,...rows].map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
 download('keyledger-orders-'+new Date().toISOString().slice(0,10)+'.csv','\ufeff'+csv,'text/csv;charset=utf-8');notify('CSV exported');
}
async function showLogs(){const logs=await api('/supplies');$('logRows').innerHTML=logs.length?logs.map(l=>`<tr><td>${esc(l.order_no)}</td><td>${esc(l.customer_id)}</td><td>${integer(l.quantity)}</td><td>${esc(new Date(l.supplied_at).toLocaleString())}</td></tr>`).join(''):'<tr><td colspan="4">No supplies recorded yet.</td></tr>';$('logsOverlay').classList.add('open');}
$('addOrderBtn').onclick=()=>openModal();
$('closeModal').onclick=closeModal;$('cancelModal').onclick=closeModal;
$('modalOverlay').onclick=e=>{if(e.target===$('modalOverlay'))closeModal();};
$('closeLogs').onclick=()=> $('logsOverlay').classList.remove('open');
$('logsOverlay').onclick=e=>{if(e.target===$('logsOverlay'))$('logsOverlay').classList.remove('open');};
['logsTop','logsBtn'].forEach(id=>$(id).onclick=()=>showLogs().catch(e=>notify(e.message)));
$('exportBtn').onclick=exportCSV;
$('saveGlobalPrice').onclick=async()=>{
  const raw=$('globalPrice').value.trim();
  if(!/^\d+(\.\d{1,2})?$/.test(raw) || Number(raw)>1000000){notify('Use a valid USD price with up to two decimal places.');return;}
  if(!confirm(`Change the selling price for ALL orders to $${Number(raw).toFixed(2)}? This also recalculates existing order totals.`))return;
  const btn=$('saveGlobalPrice');btn.disabled=true;
  try{
    const result=await api('/settings/price','PUT',{price:raw});
    globalPriceCents=result.price_cents;
    $('globalPrice').value=(globalPriceCents/100).toFixed(2);
    $('price').value=(globalPriceCents/100).toFixed(2);
    await reload();
    if(page!=='pending-orders')await renderWorkspace();
    notify(`Updated ${result.updated_orders} orders. All totals recalculated.`);
  }catch(e){notify(e.message);}finally{btn.disabled=false;}
};
$('backupBtn').onclick=async()=>{try{download('keyledger-backup-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(await api('/backup'),null,2),'application/json');notify('JSON backup exported');}catch(e){notify(e.message);}};
$('topSearch').oninput=e=>{searchTerm=e.target.value.trim().toLowerCase();render();};
$('statusFilter').onchange=e=>{filterStatus=e.target.value;render();};
document.querySelectorAll('.tab').forEach(btn=>btn.onclick=()=>{currentView=btn.dataset.view;render();});
$('rows').onclick=async e=>{
 const b=e.target.closest('button[data-action]');if(!b)return;
 const o=orders.find(x=>x.uid===b.dataset.id);if(!o)return;
 if(b.dataset.action==='edit')return openModal(o.uid);
 try{
  if(b.dataset.action==='delete'){
    if(!confirm(`Permanently delete order ${o.id} and all its supply history?`))return;
    await api('/orders/'+o.uid,'DELETE');await reload();notify('Order deleted');
  }
  if(b.dataset.action==='supply'){
    const amount=prompt(`Supply keys for ${o.id}\nRemaining: ${o.remaining}\nEnter number of keys to supply:`,String(o.remaining));
    if(amount===null)return;
    if(!/^\d+$/.test(amount.trim())||Number(amount)<1||Number(amount)>o.remaining){notify(`Enter a whole number between 1 and ${o.remaining}.`);return;}
    if(!confirm(`Confirm ${amount} keys supplied to customer ${o.buyer}?`))return;
    await api('/orders/'+o.uid+'/supply','POST',{quantity:Number(amount)});
    await reload();notify(`${amount} keys recorded as supplied`);
  }
 }catch(err){alert(err.message);}
};
$('orderForm').onsubmit=async e=>{
 e.preventDefault();const btn=$('saveBtn');btn.disabled=true;
 try{
  const qty=$('quantity').value.trim();const price=(globalPriceCents/100).toFixed(2);
  if(!/^\d+$/.test(qty) || !/^\d+(\.\d{1,2})?$/.test(price))throw new Error('Enter a valid whole-key amount and a price with no more than two decimals.');
  const body={id:$('orderId').value.trim(),buyer:$('buyer').value.trim(),quantity:Number(qty),price, status:$('status').value,product:$('product').value.trim(),notes:$('notes').value.trim()};
  await api(editingUid?'/orders/'+editingUid:'/orders',editingUid?'PUT':'POST',body);
  closeModal();await reload();notify('Order saved to database');
 }catch(err){alert(err.message);}finally{btn.disabled=false;}
};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();$('logsOverlay').classList.remove('open');}});
// The original file includes the product artwork as a data URI; kept as a separate local asset.
(async()=>{try{image=(await fetch('/key-image.txt')).ok?await(await fetch('/key-image.txt')).text():'';globalPriceCents=(await api('/settings/price')).price_cents;$('globalPrice').value=(globalPriceCents/100).toFixed(2);await reload();}catch(e){$('empty').style.display='block';$('empty').innerHTML=`<h3>Database server unavailable</h3><p>${esc(e.message)}</p>`;notify(e.message);}})();
// Additional database-backed workspace pages.
let page='pending-orders', expenses=[];
const space=$('workspacePage');
const rowHtml=(cells)=>'<tr>'+cells.map(c=>'<td>'+c+'</td>').join('')+'</tr>';
const simpleTable=(heads,rows)=>'<div class="table-wrap"><table><thead><tr>'+heads.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
const titlePage=(name,desc)=>`<h1 class="workspace-page-title">${esc(name)}</h1><p class="workspace-description">${esc(desc)}</p>`;
const cardStat=(name,value)=>`<div class="workspace-stat"><small>${esc(name)}</small><div>${esc(value)}</div></div>`;
const pnl=(heading,content)=>`<div class="workspace-panel"><h2>${esc(heading)}</h2>${content}</div>`;
const filterActive=()=>orders.filter(o=>['pending','processing'].includes(o.status));
async function switchPage(next){
  page=next;
  document.querySelectorAll('[data-page]').forEach(el=>el.classList.toggle('active',el.dataset.page===next));
  let showOrders=next==='pending-orders'||next==='tasks'||next==='requests';
  $('ordersHeader').style.display=showOrders?'':'none';
  $('ordersUtility').style.display=showOrders?'':'none';
  $('ordersCard').style.display=showOrders?'':'none';
  space.style.display=showOrders?'none':'block';
  if(next==='tasks'||next==='requests'){
    currentView='pending';filterStatus='all';$('statusFilter').value='all';render();
    $('ordersHeader').querySelector('h1').textContent=next==='tasks'?'Tasks — Needs Supply':'Pending Requests';
  } else if(next==='pending-orders'){
    currentView='all';filterStatus='all';$('statusFilter').value='all';render();
    $('ordersHeader').querySelector('h1').textContent='Pending Orders';
  }
  if(!showOrders)await renderWorkspace();
}
async function renderWorkspace(){
  const active=filterActive(), logs=(page==='transactions'||page==='logs')?await api('/supplies'):[];
  const supplied=orders.reduce((s,o)=>s+o.supplied,0);
  if(page==='home'){
    space.innerHTML=titlePage('Overview','Business activity and key supply summary')+
    `<div class="workspace-grid">${cardStat('All orders',integer(orders.length))}${cardStat('Active orders',integer(active.length))}${cardStat('Keys awaiting supply',integer(active.reduce((s,o)=>s+o.remaining,0)))}${cardStat('Keys supplied',integer(supplied))}${cardStat('Outstanding order value',usdCents(active.reduce((s,o)=>s+o.remaining*o.price_cents,0)))}</div>`+
    pnl('Recent orders',simpleTable(['Order','Customer ID','Remaining','Status'],orders.slice(0,12).map(o=>rowHtml([esc(o.id),esc(o.buyer),integer(o.remaining),esc(labels[o.status])]))))+
    `<div class="workspace-actions"><button data-go="pending-orders">Manage orders</button><button data-go="accounting">View accounting</button></div>`;
  }else if(page==='transactions'||page==='logs'){
    space.innerHTML=titlePage(page==='logs'?'Supply Logs':'Transactions','Historical key supply transactions recorded in the database')+
      `<div class="workspace-actions"><button data-csv="logs">Export supply CSV</button></div>`+
      pnl('Supply transactions',simpleTable(['Transaction','Order','Customer ID','Keys supplied','Timestamp'],logs.map(l=>rowHtml([String(l.id),esc(l.order_no),esc(l.customer_id),integer(l.quantity),esc(new Date(l.supplied_at).toLocaleString())]))));
  }else if(page==='recipients'){
    const groups=new Map();for(const o of orders){const g=groups.get(o.buyer)||{buyer:o.buyer,orders:0,keys:0,remaining:0};g.orders++;g.keys+=o.quantity;g.remaining+=o.status==='cancelled'?0:o.remaining;groups.set(o.buyer,g);}
    space.innerHTML=titlePage('Recipients','Customer IDs and order activity')+pnl('Customer list',simpleTable(['Customer ID','Orders','Total keys ordered','Keys remaining'],[...groups.values()].map(g=>rowHtml([esc(g.buyer),integer(g.orders),integer(g.keys),integer(g.remaining)]))));
  }else if(page==='bill-pay'||page==='accounting'){
    expenses=await api('/expenses');const total=expenses.reduce((s,x)=>s+x.amount_cents,0);
    const completed=orders.filter(o=>o.status==='completed').reduce((s,o)=>s+o.quantity*o.price_cents,0);
    const suppliedValue=orders.reduce((s,o)=>s+o.supplied*o.price_cents,0);
    const stats=page==='accounting'?`<div class="workspace-grid">${cardStat('Supplied sales value',usdCents(suppliedValue))}${cardStat('Completed order value',usdCents(completed))}${cardStat('Recorded expenses',usdCents(total))}${cardStat('Supplied sales minus expenses',usdCents(suppliedValue-total))}</div><p class="workspace-description">These are tracked order values, not verified payments or realized profit. Record costs below; key purchases and payments are not automatically reconciled.</p>`:'';
    space.innerHTML=titlePage(page==='accounting'?'Accounting':'Bill Pay & Expenses','Track purchase costs, supplier transfers and operational expenses')+stats+
      pnl('Record an expense',`<form id="expenseForm" class="workspace-actions"><select name="category"><option>Key purchase</option><option>Bank transfer fee</option><option>Supplier payment</option><option>Other</option></select><input name="description" required maxlength="200" placeholder="Expense description"><input name="amount" required type="number" step="0.01" min="0" placeholder="USD amount"><button type="submit">Add expense</button></form>`)+
      pnl('Expense history',`<div class="workspace-actions"><button data-csv="expenses">Export expenses CSV</button></div>`+simpleTable(['Category','Description','Amount','Recorded','Action'],expenses.map(x=>rowHtml([esc(x.category),esc(x.description),usdCents(x.amount_cents),esc(new Date(x.created_at).toLocaleString()),`<button class="mini-btn danger" data-expense-delete="${x.id}">Delete</button>`]))));
  }else if(page==='invoicing'){
    space.innerHTML=titlePage('Invoicing','Generate a printable invoice for an existing customer order')+
      pnl('Select an order',`<div class="workspace-actions"><select id="invoicePick">${orders.map(o=>`<option value="${esc(o.uid)}">${esc(o.id)} — ${esc(o.buyer)}</option>`).join('')}</select><button data-print-invoice="1">Print invoice</button></div><p class="workspace-description">An invoice is a request for payment, not proof of payment or item delivery.</p>`)+
      pnl('Order amounts',simpleTable(['Order','Customer ID','Keys','Price','Total'],orders.map(o=>rowHtml([esc(o.id),esc(o.buyer),integer(o.quantity),usdCents(o.price_cents),usdCents(o.quantity*o.price_cents)]))));
  }else{
    space.innerHTML=titlePage('Workspace','Select a section from the sidebar.');
  }
}
document.querySelectorAll('[data-page]').forEach(btn=>btn.addEventListener('click',()=>switchPage(btn.dataset.page).catch(e=>notify(e.message))));
space.addEventListener('click',async e=>{
  const go=e.target.closest('[data-go]');if(go)return switchPage(go.dataset.go);
  const del=e.target.closest('[data-expense-delete]');if(del){if(!confirm('Delete this expense entry?'))return;try{await api('/expenses/'+del.dataset.expenseDelete,'DELETE');await renderWorkspace();notify('Expense deleted');}catch(err){notify(err.message);}return;}
  const exportButton=e.target.closest('[data-csv]');if(exportButton){
    const data=exportButton.dataset.csv==='logs'?(await api('/supplies')).map(x=>[x.id,x.order_no,x.customer_id,x.quantity,x.supplied_at]):expenses.map(x=>[x.id,x.category,x.description,(x.amount_cents/100).toFixed(2),x.created_at]);
    const header=exportButton.dataset.csv==='logs'?['ID','Order','Customer ID','Quantity','Timestamp']:['ID','Category','Description','USD','Timestamp'];
    const csv=[header,...data].map(r=>r.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\r\n');
    download('keyledger-'+exportButton.dataset.csv+'.csv','\ufeff'+csv,'text/csv');notify('CSV exported');return;
  }
  if(e.target.closest('[data-print-invoice]')){
    const o=orders.find(x=>x.uid===$('invoicePick').value);if(!o)return;
    const html=`<!doctype html><html><head><title>Invoice ${esc(o.id)}</title><style>body{font-family:Arial,sans-serif;max-width:760px;margin:50px auto;color:#151a28}h1{color:#1e3a8a}table{width:100%;border-collapse:collapse;margin:30px 0}td,th{border-bottom:1px solid #ddd;text-align:left;padding:14px}footer{margin-top:55px;color:#666}</style></head><body><h1>KeyLedger Invoice</h1><p>Invoice / Order: ${esc(o.id)}</p><p>Customer ID: ${esc(o.buyer)}</p><p>Status: ${esc(labels[o.status])}</p><table><tr><th>Product</th><th>Quantity</th><th>Unit price</th><th>Total</th></tr><tr><td>${esc(o.product)}</td><td>${integer(o.quantity)}</td><td>${usdCents(o.price_cents)}</td><td>${usdCents(o.quantity*o.price_cents)}</td></tr></table><h2>Total due: ${usdCents(o.quantity*o.price_cents)} USD</h2><footer>Generated by KeyLedger. This invoice does not confirm payment.</footer></body></html>`;
    const win=window.open('','_blank');if(!win){notify('Allow pop-ups to print invoices.');return;}win.document.write(html);win.document.close();win.focus();win.print();
  }
});
space.addEventListener('submit',async e=>{
  if(e.target.id!=='expenseForm')return;e.preventDefault();
  const fd=new FormData(e.target);try{await api('/expenses','POST',{category:fd.get('category'),description:fd.get('description'),amount:fd.get('amount')});notify('Expense saved');await renderWorkspace();}catch(err){notify(err.message);}
});

})();
