// Simulador en memoria de las funciones ch_* de Supabase (misma semántica que el SQL)
(function(){
  const H=3600000, now=Date.now();
  const hoy=new Date(now-5*H).toISOString().slice(0,10);
  const colabs=[{id:'c1',nombre:'Juan Pérez',cargo:'operador'},{id:'c2',nombre:'Luis Gómez',cargo:'ag'},{id:'c3',nombre:'Ana Ruiz',cargo:'ag'},{id:'c4',nombre:'Pedro Díaz',cargo:'operador'}];
  const tcat=[{id:'t1',nombre:'Descargue contenedor',prod:20,unidad:'pallet',efic:85},{id:'t2',nombre:'Picking',prod:60,unidad:'caja',efic:85},{id:'t3',nombre:'Supervisión',prod:0,unidad:'hora',sinProd:true}];
  const clis=[{id:'k1',nombre:'CERNAC'},{id:'k2',nombre:'Alicorp'}];
  const task=(id,tc,cli,cols,ini,dur,cant)=>({id,tareaId:tc.id,tarea:tc.nombre,clienteId:cli.id,cliente:cli.nombre,colaboradores:cols,inicio:ini,fin:ini+dur*H,durH:dur,cant:cant||0,unidad:tc.unidad,prod:tc.prod,efic:cant?cant/dur/tc.prod*100:null,realProd:cant?cant/dur:0});
  const t0=now-30*24*H;
  const turnoHist={id:'th1',fecha:'2026-10-20',hora:'08:00',inicio:t0,fin:t0+9*H,equipo:[colabs[0],colabs[1]],jornada:'completa',hpPorPersona:8,horasProd:16,estado:'cerrado',
    historial:[task('h1',tcat[0],clis[0],[colabs[0],colabs[1]],t0,4,72),task('h2',tcat[1],clis[1],[colabs[0]],t0+5*H,3,170)],costoPagado:99,costoProductivo:10};
  const turnoSab={id:'th2',fecha:'2026-10-24',hora:'08:00',inicio:t0+H*100,fin:t0+H*105,equipo:[colabs[0]],jornada:'media',hpPorPersona:4,horasProd:4,estado:'cerrado',
    historial:[task('h3',tcat[0],clis[0],[colabs[0]],t0+H*100,4,80)]};
  const ini=now-3*H;
  const state={colaboradores:colabs,tareasCat:tcat,clientes:clis,turnosHistorial:[turnoHist,turnoSab],solicitudes:[],turnosProgramados:[],rutinas:[],plantillas:[],temaHSE:[],
    config:{horaInicio:'08:00',horaFin:'17:00',horasAlmuerzo:1,multSobretiempo:1.5,horasSabado:4,multSabado:1.5,horasDomingo:0,multDomingo:2},
    turno:{id:'tv1',fecha:hoy,hora:'08:00',inicio:ini,equipo:colabs.slice(0,3),jornada:'completa',hpPorPersona:8,horasProd:24,toolboxDone:true,tareasDia:[]},
    historial:[task('a1',tcat[0],clis[0],[colabs[0],colabs[1]],ini,2,40)],
    tareasActivas:[{id:'act1',tareaId:'t2',tarea:'Picking',clienteId:'k2',cliente:'Alicorp',colaboradores:[colabs[2]],inicio:now-40*60000,prod:60,unidad:'caja'}]};
  const SRV=window.__SRV={rows:{ctrl_horas_test:{value:JSON.parse(JSON.stringify(state)),version:5}},
    users:[{id:'u1',username:'admin',nombre:'Admin Prueba',rol:'admin',pass:'secreto1',activo:true},{id:'u2',username:'super',nombre:'Super Visor',rol:'supervisor',pass:'secreto2',activo:true}],
    sessions:JSON.parse(localStorage.getItem('__mock_sess')||'{}'),calls:[]};
  const err=(m,code)=>({data:null,error:{message:m,code}});
  const normCed=c=>String(c||'').replace(/\s/g,'').toUpperCase();
  const fechaPA=ms=>new Date(ms-new Date(ms).getTimezoneOffset()*60000).toISOString().slice(0,10);   // el servidor usa hora de Panamá; aquí, la del equipo
  SRV.personal=[]; SRV.marcas=[]; SRV.marcaSeq=0;
  const user=t=>{const uid=SRV.sessions[t];const u=SRV.users.find(x=>x.id===uid&&x.activo);return u;};
  const clone=o=>JSON.parse(JSON.stringify(o));
  const strip=v=>{const o=clone(v||{});delete o.usuarios;return o;};
  const fns={
    ch_login:a=>{const u=SRV.users.find(x=>x.username===String(a.p_username).toLowerCase()&&x.pass===a.p_pass&&x.activo);if(!u)return err('CREDENCIALES','28000');const t='tok'+Math.random();SRV.sessions[t]=u.id;localStorage.setItem('__mock_sess',JSON.stringify(SRV.sessions));return{data:{token:t,user:{id:u.id,username:u.username,nombre:u.nombre,rol:u.rol}}};},
    ch_me:a=>{const u=user(a.p_token);return u?{data:{id:u.id,username:u.username,nombre:u.nombre,rol:u.rol}}:err('SESION','28000');},
    ch_logout:a=>{delete SRV.sessions[a.p_token];return{data:null};},
    ch_get_state:a=>{if(!user(a.p_token))return err('SESION','28000');const r=SRV.rows[a.p_key];return{data:r?{value:strip(r.value),version:r.version}:{value:null,version:0}};},
    ch_version:a=>{if(!user(a.p_token))return err('SESION','28000');return{data:(SRV.rows[a.p_key]||{version:0}).version};},
    ch_save_state:a=>{const u=user(a.p_token);if(!u)return err('SESION','28000');const r=SRV.rows[a.p_key];if(r.version!==a.p_version)return err('CONFLICT','40001');r.value=strip(a.p_value);r.version++;return{data:r.version};},
    ch_tv_state:a=>{const v=SRV.rows[a.p_key].value;return{data:{turno:v.turno,tareasActivas:v.tareasActivas,historial:v.historial,turnosHistorial:v.turnosHistorial,colaboradores:v.colaboradores,config:v.config,lineas:(v.lineas||[]).filter(l=>l.estado==='corriendo'||l.fecha===new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10))}};},
    ch_list_users:a=>{const u=user(a.p_token);if(!u)return err('SESION','28000');if(u.rol!=='admin')return err('PERMISO','42501');return{data:SRV.users.filter(x=>x.activo).map(x=>({id:x.id,username:x.username,nombre:x.nombre,rol:x.rol}))};},
    ch_upsert_user:a=>{const u=user(a.p_token);if(u.rol!=='admin')return err('PERMISO');if(a.p_pass&&a.p_pass.length<6)return err('CLAVE_CORTA');
      if(SRV.users.some(x=>x.username===a.p_username&&x.id!==a.p_id&&x.activo))return err('USUARIO_EXISTE');
      const ex=SRV.users.find(x=>x.id===a.p_id);if(!ex){if(!a.p_pass)return err('CLAVE_CORTA');SRV.users.push({id:'u'+Math.random(),username:a.p_username,nombre:a.p_nombre,rol:a.p_rol,pass:a.p_pass,activo:true});}
      else{Object.assign(ex,{username:a.p_username,nombre:a.p_nombre,rol:a.p_rol});if(a.p_pass)ex.pass=a.p_pass;}return{data:null};},
    // Marcaje (misma semántica que 20261031_marcaje.sql; cédula en claro solo en el simulador)
    ch_personal_list:a=>{if(!user(a.p_token))return err('SESION','28000');return{data:SRV.personal.filter(x=>x.key===a.p_key).map(x=>({id:x.id,nombre:x.nombre,puesto_def:x.puesto_def,activo:x.activo,tiene_cedula:!!x.cedula})).sort((x,y)=>x.nombre.localeCompare(y.nombre))};},
    ch_personal_upsert:a=>{const u=user(a.p_token);if(!u)return err('SESION','28000');if(u.rol!=='admin')return err('PERMISO','42501');
      const ced=normCed(a.p_cedula);if(!String(a.p_nombre||'').trim())return err('DATOS');if(ced&&ced.length<4)return err('CEDULA_CORTA');
      const id=a.p_id||('p'+Math.random().toString(36).slice(2,10));
      if(ced&&SRV.personal.some(x=>x.key===a.p_key&&x.id!==id&&x.cedula===ced))return err('CEDULA_EXISTE');
      const ex=SRV.personal.find(x=>x.key===a.p_key&&x.id===id);
      if(ex)Object.assign(ex,{nombre:a.p_nombre.trim(),puesto_def:a.p_puesto,activo:a.p_activo!==false},ced?{cedula:ced}:{});
      else SRV.personal.push({key:a.p_key,id,nombre:a.p_nombre.trim(),cedula:ced||null,puesto_def:a.p_puesto,activo:a.p_activo!==false});
      return{data:id};},
    ch_marcar:a=>{const u=user(a.p_token);if(!u)return err('SESION','28000');if(u.rol!=='admin')return err('PERMISO','42501');
      const per=SRV.personal.find(x=>x.key===a.p_key&&x.id===a.p_persona&&x.activo);if(!per||!per.cedula||per.cedula!==normCed(a.p_cedula))return err('CEDULA','28000');
      const now=SRV.ahora?SRV.ahora():Date.now();
      const ult=SRV.marcas.filter(m=>m.key===a.p_key&&m.persona_id===a.p_persona&&!m.anulado&&Date.parse(m.ts)>now-20*3600000).sort((x,y)=>Date.parse(y.ts)-Date.parse(x.ts))[0];
      let f=fechaPA(now),pu=null;if(ult&&ult.tipo!=='salida'){f=ult.fecha;pu=ult.puesto;}
      const t=a.p_tipo;
      if(t==='entrada'){if(ult&&ult.tipo!=='salida')return err('SECUENCIA');if(!['supervisor','operador','ag','linea','responsable'].includes(a.p_puesto))return err('PUESTO');pu=a.p_puesto;}
      else if(t==='salida_almuerzo'){if(!ult||!['entrada','regreso_almuerzo'].includes(ult.tipo))return err('SECUENCIA');}
      else if(t==='regreso_almuerzo'){if(!ult||ult.tipo!=='salida_almuerzo')return err('SECUENCIA');}
      else if(t==='salida'){if(!ult||ult.tipo==='salida')return err('SECUENCIA');}
      else return err('TIPO');
      const m={id:++SRV.marcaSeq,key:a.p_key,persona_id:per.id,nombre:per.nombre,fecha:f,tipo:t,puesto:pu,ts:new Date(now).toISOString(),por:u.username,anulado:false,motivo:null,corregido_por:null,corregido_en:null};
      SRV.marcas.push(m);return{data:{id:m.id,persona_id:m.persona_id,nombre:m.nombre,fecha:m.fecha,tipo:m.tipo,puesto:m.puesto,ts:m.ts}};},
    ch_marcajes:a=>{if(!user(a.p_token))return err('SESION','28000');return{data:clone(SRV.marcas.filter(m=>m.key===a.p_key&&m.fecha>=a.p_desde&&m.fecha<=a.p_hasta).sort((x,y)=>Date.parse(x.ts)-Date.parse(y.ts)))};},
    ch_marcaje_admin:a=>{const u=user(a.p_token);if(!u)return err('SESION','28000');if(u.rol!=='admin')return err('PERMISO','42501');if(!String(a.p_motivo||'').trim())return err('MOTIVO');
      if(a.p_id==null){const per=SRV.personal.find(x=>x.key===a.p_key&&x.id===a.p_persona);if(!per)return err('PERSONA');
        const m={id:++SRV.marcaSeq,key:a.p_key,persona_id:per.id,nombre:per.nombre,fecha:a.p_fecha,tipo:a.p_tipo,puesto:a.p_puesto,ts:new Date(a.p_ts).toISOString(),por:u.username,anulado:false,motivo:a.p_motivo,corregido_por:u.username,corregido_en:new Date().toISOString()};SRV.marcas.push(m);return{data:m.id};}
      const m=SRV.marcas.find(x=>x.id===a.p_id&&x.key===a.p_key);if(!m)return{data:null};
      if(a.p_ts)m.ts=new Date(a.p_ts).toISOString();if(a.p_tipo)m.tipo=a.p_tipo;if(a.p_puesto)m.puesto=a.p_puesto;if(a.p_anulado!=null)m.anulado=a.p_anulado;
      Object.assign(m,{motivo:a.p_motivo,corregido_por:u.username,corregido_en:new Date().toISOString()});return{data:m.id};},
    ch_check_pass:a=>{const u=user(a.p_token);if(!u)return err('SESION','28000');return{data:u.rol==='admin'&&u.pass===a.p_pass};},
    ch_disable_user:a=>{const u=user(a.p_token);if(a.p_id===u.id)return err('ULTIMO_ADMIN');SRV.users.find(x=>x.id===a.p_id).activo=false;return{data:null};},
  };
  // Edge Function push-marcaje simulada: deja registro de los pedidos
  SRV.push=[]; SRV.subs=[];
  fns.ch_push_subscribe=a=>{const u=user(a.p_token);if(!u)return err('SESION','28000');if(!['admin','supervisor'].includes(u.rol))return err('PERMISO','42501');SRV.subs=SRV.subs.filter(x=>x.endpoint!==a.p_endpoint);SRV.subs.push({endpoint:a.p_endpoint,usuario_id:u.id,key:a.p_key});return{data:null};};
  fns.ch_push_unsubscribe=a=>{SRV.subs=SRV.subs.filter(x=>x.endpoint!==a.p_endpoint);return{data:null};};
  const functions={invoke:async(name,{body}={})=>{SRV.push.push({name,body});await new Promise(r=>setTimeout(r,5));
    if(body.accion==='clave')return{data:{publicKey:'BKfake'},error:null};
    const u=user(body.token);if(!u)return{data:null,error:{message:'SESION'}};
    if(body.accion==='marca'){if(u.rol!=='admin')return{data:null,error:{message:'PERMISO'}};const m=SRV.marcas.find(x=>x.id===body.marcaId);if(!m||m.push_enviado||!['entrada','regreso_almuerzo'].includes(m.tipo))return{data:{ok:true,enviados:0},error:null};m.push_enviado=true;return{data:{ok:true,enviados:SRV.subs.filter(x=>x.key===body.key).length},error:null};}
    if(body.accion==='prueba')return{data:{ok:true,enviados:SRV.subs.filter(x=>x.usuario_id===u.id).length},error:null};
    return{data:null,error:{message:'ACCION'}};}};
  window.supabase={createClient:()=>({functions,rpc:async(fn,args)=>{SRV.calls.push(fn);await new Promise(r=>setTimeout(r,5));
    if(SRV.offline)return{data:null,error:{message:'Failed to fetch',code:''}};
    if(!fns[fn])return err('no fn '+fn);return fns[fn](clone(args||{}));}})};
})();
