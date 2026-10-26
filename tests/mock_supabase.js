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
    ch_tv_state:a=>{const v=SRV.rows[a.p_key].value;return{data:{turno:v.turno,tareasActivas:v.tareasActivas,historial:v.historial,turnosHistorial:v.turnosHistorial,colaboradores:v.colaboradores,config:v.config}};},
    ch_list_users:a=>{const u=user(a.p_token);if(!u)return err('SESION','28000');if(u.rol!=='admin')return err('PERMISO','42501');return{data:SRV.users.filter(x=>x.activo).map(x=>({id:x.id,username:x.username,nombre:x.nombre,rol:x.rol}))};},
    ch_upsert_user:a=>{const u=user(a.p_token);if(u.rol!=='admin')return err('PERMISO');if(a.p_pass&&a.p_pass.length<6)return err('CLAVE_CORTA');
      if(SRV.users.some(x=>x.username===a.p_username&&x.id!==a.p_id&&x.activo))return err('USUARIO_EXISTE');
      const ex=SRV.users.find(x=>x.id===a.p_id);if(!ex){if(!a.p_pass)return err('CLAVE_CORTA');SRV.users.push({id:'u'+Math.random(),username:a.p_username,nombre:a.p_nombre,rol:a.p_rol,pass:a.p_pass,activo:true});}
      else{Object.assign(ex,{username:a.p_username,nombre:a.p_nombre,rol:a.p_rol});if(a.p_pass)ex.pass=a.p_pass;}return{data:null};},
    ch_disable_user:a=>{const u=user(a.p_token);if(a.p_id===u.id)return err('ULTIMO_ADMIN');SRV.users.find(x=>x.id===a.p_id).activo=false;return{data:null};},
  };
  window.supabase={createClient:()=>({rpc:async(fn,args)=>{SRV.calls.push(fn);await new Promise(r=>setTimeout(r,5));
    if(SRV.offline)return{data:null,error:{message:'Failed to fetch',code:''}};
    if(!fns[fn])return err('no fn '+fn);return fns[fn](clone(args||{}));}})};
})();
