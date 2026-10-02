import { useState } from "react";


function Icon({ name, size = 18 }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></>,
    report: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    building: <><path d="M3 21h18M6 21V7l6-4 6 4v14"/><path d="M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1"/></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/></>,
    moon: <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    award: <><circle cx="12" cy="8" r="6"/><path d="M8.5 13 7 22l5-3 5 3-1.5-9"/></>,
    spark: <path d="m12 2 1.5 5.2L18 10l-4.5 2.8L12 18l-1.5-5.2L6 10l4.5-2.8L12 2ZM5 17l.6 2.1L8 20l-2.4.9L5 23l-.6-2.1L2 20l2.4-.9L5 17Z"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    download: <><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    filter: <path d="M4 5h16M7 12h10M10 19h4"/>,
    x: <path d="m6 6 12 12M18 6 6 18"/>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function Button({ children, variant = "primary", icon, onClick, type = "button" }) {
  return <button type={type} className={`button button-${variant}`} onClick={onClick}>{children}{icon && <Icon name={icon} size={16}/>}</button>;
}

function Badge({ children, tone = "neutral" }) {
  return <span className={`badge badge-${tone}`}>{tone === "green" && <i/>}{children}</span>;
}

function Logo() {
  return <div className="brand"><span className="brand-mark"><span>CB</span></span><span className="brand-word">Campus<span>Buzz</span></span></div>;
}

const roleLabels = { student: "Student", faculty: "Faculty Coordinator", admin: "Institutional Admin", login: "Sign in" };

function Sidebar({ role, onRole }) {
  const nav = [
    { role: "student", icon: "grid", label: "Student Hub" },
    { role: "faculty", icon: "shield", label: "Faculty Desk" },
    { role: "admin", icon: "building", label: "Institution" },
  ];
  return <aside className="sidebar">
    <Logo/>
    <div className="workspace-label">WORKSPACES</div>
    <nav>
      {nav.map(item => <button key={item.role} className={`nav-item ${role === item.role ? "active" : ""}`} onClick={() => onRole(item.role)}><Icon name={item.icon}/><span>{item.label}</span>{role === item.role && <span className="nav-dot"/>}</button>)}
    </nav>
    <div className="sidebar-card">
      <span className="mini-icon"><Icon name="spark" size={16}/></span>
      <strong>Spring ’25</strong>
      <p>Credit cycle closes in 18 days.</p>
      <div className="progress"><span/></div>
      <small>76% verified</small>
    </div>
    <div className="sidebar-bottom">
      <button className="user-mini" onClick={() => onRole("login")}>
        <span className="avatar">AV</span>
        <span><strong>Ananya Verma</strong><small>Student account</small></span>
        <Icon name="logout" size={16}/>
      </button>
    </div>
  </aside>;
}

function Topbar({ role, dark, onTheme }) {
  return <header className="topbar">
    <div><span className="eyebrow">CAMPUSBUZZ / {roleLabels[role].toUpperCase()}</span><p>Tuesday, 18 February</p></div>
    <div className="top-actions">
      <label className="search"><Icon name="search" size={16}/><input aria-label="Search" placeholder="Search anything..."/><kbd>⌘ K</kbd></label>
      <button className="icon-button" aria-label="Toggle theme" onClick={onTheme}><Icon name={dark ? "sun" : "moon"}/></button>
      <button className="icon-button notice" aria-label="Notifications"><Icon name="bell"/><i/></button>
      <span className="top-avatar">AV</span>
    </div>
  </header>;
}

const attendance = [
  ["Design Systems Sprint", "Pixel Society", "14 Feb ’25", "Innovation Lab", "04:00", "Approved"],
  ["No-Code Build Night", "Dev Collective", "08 Feb ’25", "Tech Hub 02", "03:30", "Pending"],
  ["Annual Design Summit", "Pixel Society", "25 Jan ’25", "Main Auditorium", "08:00", "Approved"],
  ["Community Mural Project", "Fine Arts Club", "18 Jan ’25", "North Campus", "05:00", "Re-verification"],
];

function StudentDashboard() {
  return <div className="page">
    <section className="welcome-row">
      <div><span className="overline">STUDENT DASHBOARD</span><h1>Good morning, Ananya.</h1><p>Your co-curricular record is <strong>on track</strong> for this semester.</p></div>
      <div className="student-id"><span className="avatar avatar-lg">AV</span><div><strong>Ananya Verma</strong><p className="mono">23BCS1047 · CSE · YEAR II</p></div><Badge tone="green">VERIFIED</Badge></div>
    </section>

    <section className="quick-row">
      <div className="section-kicker"><span>QUICK EXPORTS</span><i/></div>
      <div className="quick-actions">
        {["Semester Report", "4-Year Dossier", "Yearly Keepsake"].map((label, i) => <button key={label} className="quick-button"><span className={`quick-icon q${i}`}><Icon name={i === 0 ? "report" : i === 1 ? "award" : "spark"}/></span><span><strong>{label}</strong><small>{i === 2 ? "Visual memories" : "Verified PDF"}</small></span><Icon name="download" size={17}/></button>)}
      </div>
    </section>

    <section className="metric-grid">
      <article className="metric featured"><div className="metric-top"><span className="metric-icon"><Icon name="spark"/></span><Badge tone="lime">PRIMARY</Badge></div><p>FIRST PRIORITY CLUB</p><h2>Pixel Society</h2><div className="metric-foot"><span>Product & Visual Design</span><button aria-label="Open"><Icon name="arrow" size={16}/></button></div></article>
      <article className="metric"><div className="metric-top"><span className="metric-icon"><Icon name="clock"/></span><span className="trend">+12%</span></div><p>PRIORITY CLUB HOURS</p><h2>28.5 <small>hrs</small></h2><div className="meter"><span style={{width: "72%"}}/></div><div className="metric-foot"><span>Target: 40 hours</span><strong>72%</strong></div></article>
      <article className="metric"><div className="metric-top"><span className="metric-icon"><Icon name="award"/></span><Badge tone="green">ON TRACK</Badge></div><p>4-YEAR CREDITED HOURS</p><h2>86.0 <small>hrs</small></h2><div className="metric-foot"><span>Across 7 organizations</span><span className="mini-avatars"><i>PS</i><i>DC</i><i>+5</i></span></div></article>
      <article className="metric"><div className="metric-top"><span className="metric-icon"><Icon name="users"/></span><span className="trend">2 ACTIVE</span></div><p>LEADERSHIP ROLES</p><h2>03</h2><div className="metric-foot"><span>Design Lead · Pixel Society</span><button aria-label="Open"><Icon name="chevron" size={16}/></button></div></article>
    </section>

    <section className="content-grid">
      <article className="panel table-panel">
        <div className="panel-head"><div><span className="overline"><Icon name="lock" size={12}/> VERIFIED LEDGER</span><h3>Attendance & Credits</h3></div><Button variant="quiet">View complete ledger <Icon name="arrow" size={15}/></Button></div>
        <div className="table-wrap"><table><thead><tr>{["Event", "Club", "Date", "Venue", "Credit Hours", "Verification"].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{attendance.map((row, ri) => <tr key={row[0]}>{row.map((cell, i) => <td key={cell} className={i === 2 || i === 4 ? "mono" : ""}>{i === 0 ? <span className="event-name"><i className={`event-dot d${ri}`}/><strong>{cell}</strong></span> : i === 5 ? <Badge tone={cell === "Approved" ? "green" : cell === "Pending" ? "amber" : "red"}>{cell}</Badge> : cell}</td>)}</tr>)}</tbody></table></div>
      </article>
      <article className="panel report-status">
        <div className="panel-head"><div><span className="overline">SPRING 2025</span><h3>Report status</h3></div><button className="more">•••</button></div>
        <div className="score-ring"><div><strong>76</strong><small>%</small></div></div>
        <p className="center-copy">32 of 42 logged hours are institutionally verified.</p>
        <div className="status-list"><div><span><i className="status-dot green"/><strong>Approved</strong></span><b>32.0 h</b></div><div><span><i className="status-dot amber"/><strong>Pending</strong></span><b>6.0 h</b></div><div><span><i className="status-dot red"/><strong>Re-verification</strong></span><b>4.0 h</b></div></div>
        <Button>Open semester report</Button>
      </article>
    </section>
  </div>;
}

function FacultyDashboard() {
  const approvals = [
    { title: "Interaction Design Workshop", date: "22 FEB", meta: "4 hours · Innovation Lab", club: "Pixel Society" },
    { title: "Campus Rebrand Sprint", date: "01 MAR", meta: "6 hours · Design Studio", club: "Pixel Society" },
  ];
  return <div className="page">
    <section className="welcome-row"><div><span className="overline">FACULTY COORDINATOR</span><h1>Review desk.</h1><p>There are <strong>8 items</strong> awaiting your attention.</p></div><div className="student-id insignia-card"><span className="club-insignia">PS</span><div><strong>Pixel Society</strong><p>Department of Computer Science</p></div><Badge tone="amber">8 ACTIONS</Badge></div></section>
    <section className="faculty-grid">
      <div>
        <div className="section-title"><div><span className="overline">PUBLISHING QUEUE</span><h3>Event permissions</h3></div><Badge tone="neutral">02 REQUESTS</Badge></div>
        <div className="approval-stack">{approvals.map((item, i) => <article className="panel approval-card" key={item.title}><div className="date-tile"><strong>{item.date.split(" ")[0]}</strong><small>{item.date.split(" ")[1]}</small></div><div className="approval-info"><Badge tone={i ? "neutral" : "lime"}>{item.club}</Badge><h3>{item.title}</h3><p><Icon name="calendar" size={15}/>{item.meta}</p></div><div className="approval-actions"><Button variant="primary" icon="arrow">Grant & publish</Button><Button variant="quiet">Reject</Button></div></article>)}</div>
      </div>
      <article className="panel generator">
        <span className="metric-icon"><Icon name="report"/></span><span className="overline">REPORT STUDIO</span><h3>Generate a verified report</h3><p>Compile signed participation data in one click.</p>
        <div className="segmented">{["Yearly", "Monthly", "Weekly", "Event"].map((x, i) => <button className={i === 0 ? "active" : ""} key={x}>{x}</button>)}</div>
        <label className="field-label">ACADEMIC YEAR<select defaultValue="2024–25"><option>2024–25</option><option>2023–24</option></select></label>
        <Button icon="download">Generate report</Button>
      </article>
    </section>
    <article className="panel verification">
      <div className="panel-head"><div><span className="overline">STUDENT REPORT VERIFICATION</span><h3>Ananya Verma · <span className="mono">23BCS1047</span></h3></div><Badge tone="amber">NEEDS REVIEW</Badge></div>
      <div className="verify-split">
        <div className="evidence"><div className="document-preview"><div className="doc-top"><Logo/><Badge tone="green">ATTENDANCE PROOF</Badge></div><div className="doc-lines"><span/><span/><span/><span/></div><div className="signature">Digitally submitted<br/><strong>Ananya Verma</strong></div></div></div>
        <div className="verify-details"><div className="detail-row"><span>EVENT</span><strong>Community Mural Project</strong></div><div className="detail-row"><span>CLAIMED HOURS</span><strong className="mono">05:00</strong></div><div className="detail-row"><span>SUBMITTED</span><strong className="mono">18 JAN 2025 · 18:42</strong></div><label className="field-label">REVIEW REMARKS<textarea placeholder="Add a note for the student..."/></label><div className="verify-actions"><Button variant="green" icon="check">Approve & sign-off</Button><Button variant="amber">Send back</Button><Button variant="danger">Reject</Button></div></div>
      </div>
    </article>
    <section><div className="section-title"><div><span className="overline">STUDENT LEADERSHIP</span><h3>Club coordinators</h3></div><Button variant="quiet" icon="plus">Assign coordinator</Button></div><div className="coordinator-row">{[["RS","Rohan Shah","Lead Coordinator"],["MI","Meera Iyer","Operations"],["AK","Arjun Khanna","Design Lead"]].map(x => <article className="coordinator" key={x[1]}><span className="avatar">{x[0]}</span><div><strong>{x[1]}</strong><p>{x[2]}</p></div><Badge tone="green">ACTIVE</Badge></article>)}</div></section>
  </div>;
}

function AdminDashboard() {
  const clubs = [
    ["PS","Pixel Society","12","184","Dr. Mira Sen","3"],
    ["DC","Dev Collective","18","241","Prof. A. Menon","4"],
    ["FA","Fine Arts Club","09","126","Dr. Ritu Jain","2"],
    ["RC","Robotics Core","14","198","Prof. K. Rao","3"],
  ];
  return <div className="page">
    <section className="welcome-row"><div><span className="overline">INSTITUTIONAL COMMAND</span><h1>Campus overview.</h1><p>Live co-curricular intelligence across the institution.</p></div><div className="institution"><span className="emblem"><Icon name="building" size={28}/></span><div><strong>Northbridge Institute</strong><p>Autonomous · NAAC A++</p></div></div></section>
    <section className="admin-stats">{[["building","42","Total clubs","+4 this year"],["calendar","386","Events","32 this month"],["users","12,840","Participations","+18.2% YoY"]].map((s,i) => <article className={`panel stat-wide s${i}`} key={s[2]}><span className="metric-icon"><Icon name={s[0]}/></span><div><p>{s[2]}</p><h2>{s[1]}</h2></div><Badge tone={i === 1 ? "lime" : "green"}>{s[3]}</Badge></article>)}</section>
    <section className="admin-layout">
      <article className="panel directory"><div className="panel-head"><div><span className="overline">REGISTERED ORGANIZATIONS</span><h3>Club directory</h3></div><div className="inline-tools"><label className="search small"><Icon name="search" size={15}/><input placeholder="Search clubs"/></label><button className="icon-button"><Icon name="filter" size={16}/></button></div></div>
        <div className="table-wrap"><table><thead><tr>{["Club","Events","Members","Faculty in-charge","Coordinators",""].map((h,i)=><th key={i}>{h}</th>)}</tr></thead><tbody>{clubs.map((c,ri)=><tr key={c[1]} className={ri===0?"selected":""}><td><span className="club-cell"><i>{c[0]}</i><strong>{c[1]}</strong></span></td><td className="mono">{c[2]}</td><td className="mono">{c[3]}</td><td>{c[4]}</td><td><span className="avatar-stack"><i/><i/><i/>{c[5]}</span></td><td><Icon name="chevron" size={15}/></td></tr>)}</tbody></table></div>
      </article>
      <article className="panel dossier"><div className="dossier-head"><span className="club-insignia">PS</span><div><Badge tone="green">IN GOOD STANDING</Badge><h3>Pixel Society</h3><p>Club Audit Dossier · 2024–25</p></div><button className="icon-button"><Icon name="download" size={16}/></button></div>
        <div className="dossier-stats"><div><span>EVENTS</span><strong>12</strong></div><div><span>VERIFIED HRS</span><strong>684</strong></div><div><span>MEMBERS</span><strong>184</strong></div></div>
        <div className="audit-title"><span>LATEST VERIFIED ATTENDANCE</span><Badge>LIVE AUDIT</Badge></div>
        <div className="audit-list">{[["Ananya Verma","23BCS1047","14 FEB · 18:42"],["Rohan Shah","22BCS0834","14 FEB · 18:41"],["Meera Iyer","23BDE1021","14 FEB · 18:39"]].map((x,i)=><div key={x[1]}><span className="avatar">{x[0].split(" ").map(n=>n[0]).join("")}</span><span><strong>{x[0]}</strong><small className="mono">{x[1]}</small></span><time className="mono">{x[2]}</time><Icon name="check" size={14}/></div>)}</div>
        <div className="faculty-line"><span className="avatar">MS</span><div><small>FACULTY IN-CHARGE</small><strong>Dr. Mira Sen</strong></div><Badge tone="green">VERIFIED</Badge></div>
        <Button icon="arrow">Open full audit dossier</Button>
      </article>
    </section>
  </div>;
}

function LoginScreen({ onLogin }) {
  const [selected, setSelected] = useState("student");
  const roles = [
    { id: "student", label: "Student", icon: "award", copy: "Track credits & clubs" },
    { id: "faculty", label: "Faculty", icon: "shield", copy: "Review & approve" },
    { id: "admin", label: "Institution", icon: "building", copy: "Manage ecosystem" },
    { id: "login", label: "Organizer", icon: "users", copy: "Run club operations" },
  ];
  return <div className="login-screen">
    <div className="login-visual"><Logo/><div className="visual-copy"><Badge tone="lime">THE CAMPUS OPERATING SYSTEM</Badge><h1>Every contribution.<br/><span>Credited.</span></h1><p>One verified record for the work that happens beyond the classroom.</p></div><div className="orb orb-one"/><div className="orb orb-two"/><div className="floating-card f-one"><Icon name="check"/><span><small>JUST VERIFIED</small><strong>Design Summit · 8.0 hours</strong></span></div><div className="floating-card f-two"><span className="avatar">AV</span><span><small>4-YEAR DOSSIER</small><strong>86 verified hours</strong></span></div><small className="copyright">© 2025 CAMPUSBUZZ · SECURE ACADEMIC RECORDS</small></div>
    <main className="login-form-wrap"><button className="back-button" onClick={() => onLogin("student")}><Icon name="arrow" size={16}/> Back to dashboard</button><div className="login-form"><span className="overline">SECURE PORTAL</span><h2>Welcome back.</h2><p>Choose your workspace to continue.</p><div className="role-picker">{roles.map(r=><button key={r.label} className={selected===r.id?"active":""} onClick={()=>setSelected(r.id)}><Icon name={r.icon}/><span><strong>{r.label}</strong><small>{r.copy}</small></span>{selected===r.id&&<i><Icon name="check" size={11}/></i>}</button>)}</div><label className="field-label">INSTITUTIONAL EMAIL<input defaultValue="ananya.verma@northbridge.edu"/></label><label className="field-label">PASSWORD<div className="password-field"><input type="password" defaultValue="password123"/><button>SHOW</button></div></label><div className="login-options"><label><input type="checkbox" defaultChecked/>Keep me signed in</label><button>Forgot password?</button></div><Button type="submit" icon="arrow" onClick={()=>onLogin(selected==="login"?"student":selected)}>Enter CampusBuzz</Button><div className="sso"><span>OR CONTINUE WITH SSO</span><Button variant="quiet"><Icon name="building" size={16}/>Institutional login</Button></div><p className="secure"><Icon name="lock" size={13}/> Protected by Northbridge SSO and 256-bit encryption</p></div></main>
  </div>;
}

export default function App() {
  const [role, setRole] = useState("student");
  const [dark, setDark] = useState(true);
  if (role === "login") return <div className={dark ? "theme-dark" : "theme-light"}><LoginScreen onLogin={setRole}/></div>;
  return <div className={`app-shell ${dark ? "theme-dark" : "theme-light"}`}><Sidebar role={role} onRole={setRole}/><main className="main-area"><Topbar role={role} dark={dark} onTheme={()=>setDark(!dark)}/>{role === "student" ? <StudentDashboard/> : role === "faculty" ? <FacultyDashboard/> : <AdminDashboard/>}</main></div>;
}
