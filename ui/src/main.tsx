import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Tool = { name: string; description?: string; enabled: boolean; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } };
type Mcp = { id: string; label: string; enabled: boolean; command?: string; url?: string; status: "stopped"|"connecting"|"running"|"error"; error?: string; tools: Tool[] };
const hubs = [
  { name:"Smithery", url:"https://smithery.ai", description:"Каталог и hosted MCP-серверы", embed:true, color:"#6f58e8" },
  { name:"MCP.so", url:"https://mcp.so", description:"Большой каталог community-серверов", embed:true, color:"#e86f43" },
  { name:"Glama", url:"https://glama.ai/mcp/servers", description:"Поиск по серверам и инструментам", embed:false, color:"#2c8061" },
  { name:"PulseMCP", url:"https://www.pulsemcp.com/servers", description:"Популярность, подборки и категории", embed:false, color:"#2672d9" },
  { name:"Official Registry", url:"https://registry.modelcontextprotocol.io/docs", description:"Официальный реестр и API MCP", embed:false, color:"#17201d" }
] as const;
type Hub = typeof hubs[number];
type Theme = { accent:string; sidebar:string; background:string };
const defaultTheme:Theme={accent:"#b9f63b",sidebar:"#12231e",background:"#f4f6f2"};
const themePresets=[defaultTheme,{accent:"#73a7ff",sidebar:"#101b31",background:"#f3f6fb"},{accent:"#ff9f6e",sidebar:"#2b1720",background:"#fff6f1"},{accent:"#d7b7ff",sidebar:"#211a2e",background:"#f8f4fc"}];
const sample = `{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:/workspace"]
    }
  }
}`;

function App() {
  const [servers,setServers]=useState<Mcp[]>([]), [selected,setSelected]=useState<string>(), [modal,setModal]=useState(false), [settings,setSettings]=useState(false), [json,setJson]=useState(sample), [error,setError]=useState(""), [page,setPage]=useState<"servers"|"catalog">("servers"), [hub,setHub]=useState<Hub>(hubs[0]), [viewerKey,setViewerKey]=useState(0), [theme,setTheme]=useState<Theme>(()=>{try{return JSON.parse(localStorage.getItem("mcp-hub-theme")||"") }catch{return defaultTheme}});
  const load=async()=>{const r=await fetch("/api/state");const x=await r.json();setServers(x.servers);setSelected(v=>v??x.servers[0]?.id)};
  useEffect(()=>{load();const timer=setInterval(load,3000);return()=>clearInterval(timer)},[]);
  const post=async(url:string,body:unknown)=>{setError("");const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const x=await r.json();if(!r.ok)throw new Error(x.error);setServers(x.servers);return x};
  const current=servers.find(s=>s.id===selected);
  const importJson=async()=>{try{const x=await post("/api/import",JSON.parse(json));setSelected(x.added[0]);setPage("servers");setModal(false)}catch(e){setError(e instanceof Error?e.message:String(e))}};
  const remove=async(server:Mcp)=>{if(!confirm(`Удалить MCP-сервер «${server.label}»? Его процесс будет остановлен, а настройки инструментов удалены.`))return;const r=await fetch(`/api/servers/${server.id}`,{method:"DELETE"});const x=await r.json();if(!r.ok){setError(x.error);return}setServers(x.servers);setSelected(x.servers[0]?.id)};
  const updateTheme=(next:Theme)=>{setTheme(next);localStorage.setItem("mcp-hub-theme",JSON.stringify(next))};
  return <div className="shell" style={{"--accent":theme.accent,"--sidebar":theme.sidebar,"--background":theme.background} as React.CSSProperties}><aside>
    <div className="brand"><div className="logo">M</div><div><b>MCP Hub</b><span>Local router</span></div></div>
    <button className="add" onClick={()=>{setError("");setModal(true)}}>＋ Подключить MCP</button>
    <div className="main-nav"><button className={page==="servers"?"active":""} onClick={()=>setPage("servers")}>◫ Мои серверы</button><button className={page==="catalog"?"active":""} onClick={()=>setPage("catalog")}>◉ Каталог MCP</button></div>
    <div className="section-title">Серверы <span>{servers.length}</span></div>
    <nav>{servers.map(s=><button key={s.id} className={page==="servers"&&selected===s.id?"active":""} onClick={()=>{setSelected(s.id);setPage("servers")}}><i className={s.status}/><div><b>{s.label}</b><small>{s.tools.filter(t=>t.enabled).length}/{s.tools.length} tools</small></div></button>)}</nav>
    <div className="endpoint"><span>Router endpoint</span><code>http://127.0.0.1:7331/mcp</code></div>
    <button className="settings-button" onClick={()=>setSettings(true)}>⚙ Настроить интерфейс</button>
  </aside><main>{page==="catalog"?<Catalog hub={hub} setHub={setHub} viewerKey={viewerKey} reload={()=>setViewerKey(x=>x+1)}/>:current?<>
    <header><div><p>MCP SERVER</p><h1>{current.label}</h1><span className={`badge ${current.status}`}>{current.status}</span></div><div className="actions"><button className="delete" onClick={()=>remove(current)}>Удалить</button><button onClick={()=>post(`/api/servers/${current.id}/restart`,{})}>↻ Перезапустить</button><label className="switch"><input type="checkbox" checked={current.enabled} onChange={e=>post(`/api/servers/${current.id}/enabled`,{enabled:e.target.checked})}/><span/></label></div></header>
    {current.error&&<div className="alert">{current.error}</div>}
    <section className="summary"><div><span>Транспорт</span><b>{current.url?"Streamable HTTP":"stdio"}</b></div><div><span>Инструментов</span><b>{current.tools.length}</b></div><div><span>Доступно модели</span><b>{current.tools.filter(t=>t.enabled).length}</b></div></section>
    <section className="tools"><div className="tools-head"><div><h2>Инструменты</h2><p>Отключённые инструменты не попадают в tools/list и не могут быть вызваны напрямую.</p></div><div><button onClick={()=>post(`/api/servers/${current.id}/tools`,{enabled:true})}>Включить все</button><button onClick={()=>post(`/api/servers/${current.id}/tools`,{enabled:false})}>Отключить все</button></div></div>
      {current.tools.length?current.tools.map(t=><article key={t.name}><label className="check"><input type="checkbox" checked={t.enabled} onChange={e=>post(`/api/servers/${current.id}/tools/${encodeURIComponent(t.name)}`,{enabled:e.target.checked})}/><span>✓</span></label><div><div className="tool-title"><code>{t.name}</code>{t.annotations?.readOnlyHint&&<em>READ ONLY</em>}{t.annotations?.destructiveHint&&<em className="danger">DESTRUCTIVE</em>}</div><p>{t.description||"Описание не предоставлено"}</p></div></article>):<div className="empty">{current.status==="running"?"Сервер не объявил инструменты":"Запустите сервер, чтобы загрузить инструменты"}</div>}
    </section></>:<div className="welcome"><div className="logo big">M</div><h1>Подключите первый MCP</h1><p>Импортируйте привычную JSON-конфигурацию или сначала найдите сервер в каталоге.</p><div className="welcome-buttons"><button className="add" onClick={()=>setModal(true)}>＋ Подключить MCP</button><button onClick={()=>setPage("catalog")}>Открыть каталог</button></div></div>}</main>
    {modal&&<div className="overlay" onMouseDown={e=>e.target===e.currentTarget&&setModal(false)}><div className="modal"><button className="close" onClick={()=>setModal(false)}>×</button><p className="eyebrow">НОВОЕ ПОДКЛЮЧЕНИЕ</p><h2>Импорт MCP JSON</h2><p>Поддерживаются конфигурации с <code>mcpServers</code> и обычный объект серверов.</p><textarea value={json} onChange={e=>setJson(e.target.value)} spellCheck={false}/>{error&&<div className="alert">{error}</div>}<div className="modal-actions"><button onClick={()=>setModal(false)}>Отмена</button><button className="primary" onClick={importJson}>Проверить и подключить</button></div></div></div>}
    {settings&&<div className="overlay" onMouseDown={e=>e.target===e.currentTarget&&setSettings(false)}><div className="modal settings-modal"><button className="close" onClick={()=>setSettings(false)}>×</button><p className="eyebrow">ПЕРСОНАЛИЗАЦИЯ</p><h2>Цвета интерфейса</h2><p>Настройки сохраняются на этом компьютере автоматически.</p><div className="presets">{themePresets.map((p,i)=><button key={i} className={JSON.stringify(p)===JSON.stringify(theme)?"active":""} onClick={()=>updateTheme(p)}><i style={{background:p.sidebar}}/><i style={{background:p.background}}/><i style={{background:p.accent}}/></button>)}</div><div className="color-fields"><label><span>Акцент</span><input type="color" value={theme.accent} onChange={e=>updateTheme({...theme,accent:e.target.value})}/><code>{theme.accent}</code></label><label><span>Боковая панель</span><input type="color" value={theme.sidebar} onChange={e=>updateTheme({...theme,sidebar:e.target.value})}/><code>{theme.sidebar}</code></label><label><span>Фон</span><input type="color" value={theme.background} onChange={e=>updateTheme({...theme,background:e.target.value})}/><code>{theme.background}</code></label></div><div className="modal-actions"><button onClick={()=>updateTheme(defaultTheme)}>Сбросить</button><button className="primary" onClick={()=>setSettings(false)}>Готово</button></div></div></div>}
  </div>;
}

function Catalog({hub,setHub,viewerKey,reload}:{hub:Hub;setHub:(h:Hub)=>void;viewerKey:number;reload:()=>void}) {
  return <div className="catalog"><header><div><p>DISCOVERY</p><h1>Каталоги MCP</h1></div><a className="external" href={hub.url} target="_blank" rel="noreferrer">Открыть отдельно ↗</a></header><p className="catalog-lead">Ищите серверы в популярных реестрах. Перед подключением проверяйте автора, исходный код и запрашиваемые права.</p>
    <div className="hub-tabs">{hubs.map(h=><button key={h.name} className={hub.name===h.name?"active":""} onClick={()=>setHub(h)}><i style={{background:h.color}}>{h.name[0]}</i><span><b>{h.name}</b><small>{h.description}</small></span></button>)}</div>
    <section className="browser-panel"><div className="browser-bar"><div className="traffic"><i/><i/><i/></div><button onClick={reload}>↻</button><div className="address">🔒 {hub.url}</div><a href={hub.url} target="_blank" rel="noreferrer">↗</a></div>{hub.embed?<iframe key={`${hub.name}-${viewerKey}`} src={hub.url} title={hub.name} sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts allow-downloads"/>:<div className="embed-blocked"><i style={{background:hub.color}}>{hub.name[0]}</i><h2>{hub.name} защищает страницу от встраивания</h2><p>Это ограничение безопасности самого каталога. Откройте его отдельно — навигация и все функции будут доступны.</p><a href={hub.url} target="_blank" rel="noreferrer">Открыть {hub.name} ↗</a></div>}</section>
  </div>;
}
createRoot(document.getElementById("root")!).render(<App/>);
