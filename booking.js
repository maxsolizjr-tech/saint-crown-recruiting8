
(() => {
  const currentZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago";
  const zones = [
    ["America/Chicago","Central Time"],["America/New_York","Eastern Time"],
    ["America/Denver","Mountain Time"],["America/Phoenix","Arizona Time"],
    ["America/Los_Angeles","Pacific Time"],["America/Anchorage","Alaska Time"],
    ["Pacific/Honolulu","Hawaii Time"]
  ];
  if (!zones.some(z => z[0] === currentZone)) zones.push([currentZone, currentZone.replaceAll("_"," ") + " (your device)"]);
  const state = { month: "", slots: [], selectedDate: "", selectedSlot: "", zone: currentZone };
  const pad = n => String(n).padStart(2,"0");
  const monthKey = (y,m) => y + "-" + pad(m);
  const monthDate = key => { const [y,m]=key.split("-").map(Number); return new Date(Date.UTC(y,m-1,1)); };
  const centralMonth = () => {
    const p = new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",year:"numeric",month:"2-digit"}).formatToParts(new Date());
    const o = Object.fromEntries(p.map(x=>[x.type,x.value])); return o.year+"-"+o.month;
  };
  const monthLabel = key => new Intl.DateTimeFormat("en-US",{month:"long",year:"numeric",timeZone:"UTC"}).format(monthDate(key));
  const dateKey = d => {
    const p = new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(d));
    const o=Object.fromEntries(p.map(x=>[x.type,x.value])); return o.year+"-"+o.month+"-"+o.day;
  };
  const timeLabel = iso => new Intl.DateTimeFormat("en-US",{timeZone:state.zone,hour:"numeric",minute:"2-digit",timeZoneName:"short"}).format(new Date(iso));
  const el = (tag, cls, txt) => { const n=document.createElement(tag); if(cls)n.className=cls; if(txt!==undefined)n.textContent=txt; return n; };
  const modal = el("div"); modal.id="sc-booking-modal"; modal.setAttribute("aria-hidden","true");
  modal.innerHTML = `
    <div class="sc-booking-panel" role="dialog" aria-modal="true" aria-labelledby="sc-booking-title">
      <div class="sc-booking-head"><div><div class="eyebrow">Saint-Crown Recruiting</div><h2 id="sc-booking-title">Schedule a Call</h2><div class="sc-booking-muted">Choose a 30-minute appointment. Our booking hours are Monday–Friday, 8:00 AM–5:00 PM Central Time.</div></div><button type="button" class="sc-booking-close" aria-label="Close calendar">✕</button></div>
      <div class="sc-booking-timezone"><label for="sc-timezone">Your time zone</label><select id="sc-timezone"></select><span class="sc-booking-muted">Times below adjust automatically.</span></div>
      <div class="sc-booking-controls"><button type="button" id="sc-prev-month">←</button><strong id="sc-month-label"></strong><button type="button" id="sc-next-month">→</button></div>
      <div class="sc-booking-calendar" id="sc-calendar"></div>
      <div class="sc-booking-muted" id="sc-date-label" style="margin-top:16px">Select an available date to see times.</div>
      <div class="sc-booking-times" id="sc-times"></div>
      <form class="sc-booking-form" id="sc-booking-form">
        <label>Name<input name="name" required maxlength="160" autocomplete="name"></label>
        <label>Email<input name="email" type="email" required autocomplete="email"></label>
        <label class="wide">Phone number<input name="phone" type="tel" required autocomplete="tel" maxlength="40"></label>
        <div class="wide"><button class="sc-booking-submit" type="submit">Confirm Booking</button><div class="sc-booking-status" id="sc-booking-status" role="status" aria-live="polite"></div></div>
      </form>
    </div>`;
  document.body.appendChild(modal);
  const $ = s => modal.querySelector(s);
  const tz = $("#sc-timezone");
  zones.forEach(([value,label])=>{const o=el("option","",label);o.value=value;tz.appendChild(o);});
  tz.value=state.zone;
  const close = () => { modal.classList.remove("open"); modal.setAttribute("aria-hidden","true"); };
  modal.querySelector(".sc-booking-close").addEventListener("click",close);
  modal.addEventListener("click",e=>{if(e.target===modal)close();});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&modal.classList.contains("open"))close();});
  function addMonths(key,delta){const d=monthDate(key);d.setUTCMonth(d.getUTCMonth()+delta);return monthKey(d.getUTCFullYear(),d.getUTCMonth()+1);}
  async function loadMonth(){
    $("#sc-month-label").textContent=monthLabel(state.month);
    $("#sc-calendar").replaceChildren();$("#sc-times").replaceChildren();
    $("#sc-date-label").textContent="Loading available times…";
    $("#sc-prev-month").disabled=state.month<=centralMonth();
    const limit=addMonths(centralMonth(),2);$("#sc-next-month").disabled=state.month>=limit;
    try{
      const r=await fetch("/api/bookings?month="+encodeURIComponent(state.month),{cache:"no-store"});
      const data=await r.json();if(!r.ok)throw new Error(data.error||"Could not load the calendar.");
      state.slots=data.slots||[];
      if(!state.slots.length){$("#sc-date-label").textContent="No appointments are available this month. Please check the next month.";renderCalendar();return;}
      if(!state.slots.some(s=>s.centralDate===state.selectedDate))state.selectedDate=state.slots[0].centralDate;
      renderCalendar();
    }catch(e){$("#sc-date-label").textContent=e.message;$("#sc-calendar").replaceChildren();}
  }
  function renderCalendar(){
    const grid=$("#sc-calendar");grid.replaceChildren();
    ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].forEach(d=>grid.appendChild(el("div","sc-booking-weekday",d)));
    const d=monthDate(state.month),y=d.getUTCFullYear(),m=d.getUTCMonth(),offset=d.getUTCDay(),count=new Date(Date.UTC(y,m+1,0)).getUTCDate();
    for(let i=0;i<offset;i++)grid.appendChild(el("div"));
    const available=new Set(state.slots.map(s=>s.centralDate));
    for(let day=1;day<=count;day++){
      const key=y+"-"+pad(m+1)+"-"+pad(day),b=el("button","sc-booking-day",String(day));b.type="button";
      b.disabled=!available.has(key);if(key===state.selectedDate)b.classList.add("selected");
      b.addEventListener("click",()=>{state.selectedDate=key;state.selectedSlot="";renderCalendar();renderTimes();});
      grid.appendChild(b);
    }
    renderTimes();
  }
  function renderTimes(){
    const list=$("#sc-times");list.replaceChildren();
    const slots=state.slots.filter(s=>s.centralDate===state.selectedDate);
    if(!slots.length){$("#sc-date-label").textContent="Select a highlighted weekday with available appointments.";return;}
    const d=new Date(state.selectedDate+"T12:00:00Z");
    $("#sc-date-label").textContent=new Intl.DateTimeFormat("en-US",{timeZone:"UTC",weekday:"long",month:"long",day:"numeric"}).format(d)+" — available times in "+state.zone;
    slots.forEach(s=>{
      const b=el("button","sc-booking-time",timeLabel(s.startsAt));b.type="button";
      if(s.startsAt===state.selectedSlot)b.classList.add("selected");
      b.addEventListener("click",()=>{state.selectedSlot=s.startsAt;renderTimes();$("#sc-booking-status").textContent="Selected: "+timeLabel(s.startsAt);});
      list.appendChild(b);
    });
  }
  $("#sc-prev-month").addEventListener("click",()=>{if(state.month>centralMonth()){state.month=addMonths(state.month,-1);state.selectedDate="";loadMonth();}});
  $("#sc-next-month").addEventListener("click",()=>{if(state.month<addMonths(centralMonth(),2)){state.month=addMonths(state.month,1);state.selectedDate="";loadMonth();}});
  tz.addEventListener("change",()=>{state.zone=tz.value;renderTimes();});
  $("#sc-booking-form").addEventListener("submit",async e=>{
    e.preventDefault();const form=e.currentTarget,button=form.querySelector("button[type=submit]"),status=$("#sc-booking-status");
    if(!state.selectedSlot){status.textContent="Please select an available date and time.";return;}
    button.disabled=true;button.textContent="Confirming…";status.textContent="Checking availability…";
    const fd=new FormData(form);
    try{
      const r=await fetch("/api/bookings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:fd.get("name"),email:fd.get("email"),phone:fd.get("phone"),timeZone:state.zone,startsAt:state.selectedSlot})});
      const result=await r.json();
      if(r.status===409){status.textContent=result.error||"That time was just booked. Choose another slot.";state.selectedSlot="";await loadMonth();throw new Error("Please choose another available time.");}
      if(!r.ok)throw new Error(result.error||"Booking failed. Please try again.");
      const booked=state.selectedSlot;
      const bookedDate=new Intl.DateTimeFormat("en-US",{timeZone:state.zone,weekday:"long",month:"long",day:"numeric",year:"numeric"}).format(new Date(booked));
      status.textContent="Booking completed! Your call is booked for "+bookedDate+" at "+timeLabel(booked)+". "+(result.emailsSent?"A confirmation email has been sent.":"Your appointment is saved. We will set up email confirmation next.");
      form.reset();state.selectedSlot="";await loadMonth();
    }catch(err){if(err.message!=="Please choose another available time.")status.textContent=err.message;}
    finally{button.disabled=false;button.textContent="Confirm Booking";}
  });
  function open(){state.month=centralMonth();state.selectedDate="";state.selectedSlot="";$("#sc-booking-status").textContent="";modal.classList.add("open");modal.setAttribute("aria-hidden","false");loadMonth();}
  document.addEventListener("click",e=>{const link=e.target.closest("a[data-schedule-call]");if(link){e.preventDefault();open();}});
  window.addEventListener("hashchange",()=>{if(location.hash==="#schedule-call")open();});
})();
