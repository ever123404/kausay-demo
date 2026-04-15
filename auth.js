/* ═══════════════════════════════════════════════════════════════════
   KAUSAY MUNICIPAL — auth.js v2.0 — Security Hardening
   ─────────────────────────────────────────────────────────────────
   CAMBIOS v2 vs v1:
   [F1] MFA real con Supabase Auth TOTP (enrollamiento + verificación)
   [F2] Sesión única del alcalde (single-session via claims_version)
   [F3] Detección y registro de nuevo dispositivo
   [F4] Reauth endurecida con lista explícita de acciones críticas
   [F5] Audit trail completo hacia Supabase (todos los eventos)
   [F6] SupabaseAuth implementado, MockAuth preservado para demo
   ─────────────────────────────────────────────────────────────────
   ADVERTENCIA DE SEGURIDAD:
   MockAuth (USE_SUPABASE=false) NO provee seguridad real.
   Usar únicamente en demo/staging. En producción con alcalde real:
   USE_SUPABASE=true + TOTP configurado + HTTPS obligatorio.
   ═══════════════════════════════════════════════════════════════════ */

const KausayAuth = (() => {

  /* ─────────────────────────────────────────────────────────────
     CONFIG
  ───────────────────────────────────────────────────────────────*/
  const CFG = {
    USE_SUPABASE:     window.__KAUSAY_USE_SUPABASE__ || false,
    SUPABASE_URL:     window.__KAUSAY_SUPABASE_URL__ || 'TU_SUPABASE_URL',
    SUPABASE_KEY:     window.__KAUSAY_SUPABASE_KEY__ || 'TU_SUPABASE_ANON_KEY',
    SESSION_KEY:      'kausay_session_v2',
    DEVICES_KEY:      'kausay_devices_v1',   // historial de dispositivos conocidos
    AUDIT_KEY:        'kausay_auth_audit',
    SESSION_TTL_MS:   7 * 24 * 3600_000,    // 7 días
    REAUTH_TTL_MS:    15 * 60_000,           // 15 min post-reauth

    // [F1] Roles que requieren MFA TOTP obligatorio
    MFA_ROLES: ['alcalde', 'gerente_municipal'],
    // Roles donde MFA es recomendado pero no bloqueante en piloto
    MFA_RECOMMENDED: ['secretaria', 'oci_lectura', 'planeamiento'],

    // [F2] Roles con sesión única (revoca otras al iniciar nueva)
    SINGLE_SESSION_ROLES: ['alcalde'],

    // [F4] Acciones que exigen reauth (≤15 min)
    REAUTH_ACTIONS: [
      'aprobar_documento',       // alcalde aprueba doc para firma
      'devolver_documento',      // alcalde devuelve doc
      'instruccion_urgente',     // instrucción con prioridad=urgente
      'cambiar_config',          // config.html guardarTodo()
      'escalar_alcalde',         // GM escala al alcalde
      'estado_critico_obra',     // cambiar estado obra a paralizada
      'revocar_sesion',          // revocar otra sesión
      'exportar_auditoria',      // exportar log de auditoría
    ],

    REDIRECT_MAP: {
      alcalde:            'alcalde.html',
      secretaria:         'secretaria.html',
      gerente_municipal:  'gm.html',
      gerente_sectorial:  'gerente.html',
      asesor_despacho:    'asesor.html',   // radar estratégico del despacho
      planeamiento:       'gm.html',
      oci_lectura:        'gm.html',
      soporte_kausay:     'config.html',
    },
  };

  /* ─────────────────────────────────────────────────────────────
     MOCK AUTH — Solo demo. No usar en producción con alcalde real.
     [ADVERTENCIA F1]: MFA acepta cualquier código de 6 dígitos.
  ───────────────────────────────────────────────────────────────*/
  const MOCK_USERS = [
    { id:'u-001',email:'alcalde@cajamarca.gob.pe',      password:'Cajamarca2024!',nombre:'Roberto Sánchez Quiroz', rol:'alcalde',           gerencia_id:null,gerencia_cod:null,     activo:true,muni:'muni-cajamarca-001',mfa_habilitado:false },
    { id:'u-002',email:'secretaria@cajamarca.gob.pe',   password:'Despacho2024!', nombre:'Carmen Flores Ríos',    rol:'secretaria',         gerencia_id:null,gerencia_cod:null,     activo:true,muni:'muni-cajamarca-001',mfa_habilitado:false },
    { id:'u-003',email:'gm@cajamarca.gob.pe',           password:'Gerencia2024!', nombre:'Mg. Carlos Vásquez Díaz',rol:'gerente_municipal',  gerencia_id:null,gerencia_cod:null,     activo:true,muni:'muni-cajamarca-001',mfa_habilitado:false },
    { id:'u-004',email:'infra@cajamarca.gob.pe',        password:'Infra2024!',    nombre:'Ing. Ana Quispe Herrera',rol:'gerente_sectorial',  gerencia_id:'ger-infra',gerencia_cod:'INFRA',     activo:true,muni:'muni-cajamarca-001',mfa_habilitado:false },
    { id:'u-005',email:'rentas@cajamarca.gob.pe',       password:'Rentas2024!',   nombre:'Cont. Carlos Herrera D.',rol:'gerente_sectorial',  gerencia_id:'ger-rentas',gerencia_cod:'RENTAS',   activo:true,muni:'muni-cajamarca-001',mfa_habilitado:false },
    { id:'u-006',email:'servicios@cajamarca.gob.pe',    password:'Serv2024!',     nombre:'Lic. Rosa Castro Vega',  rol:'gerente_sectorial',  gerencia_id:'ger-servicios',gerencia_cod:'SERVICIOS',activo:true,muni:'muni-cajamarca-001',mfa_habilitado:false },
    { id:'u-007',email:'social@cajamarca.gob.pe',       password:'Social2024!',   nombre:'Lic. Marco Torres León', rol:'gerente_sectorial',  gerencia_id:'ger-social',gerencia_cod:'SOCIAL',   activo:true,muni:'muni-cajamarca-001',mfa_habilitado:false },
    { id:'u-008',email:'secretariaG@cajamarca.gob.pe',  password:'SecG2024!',     nombre:'Abg. Patricia Abanto R.',rol:'gerente_sectorial',  gerencia_id:'ger-secretaria',gerencia_cod:'SECRETARIA',activo:true,muni:'muni-cajamarca-001',mfa_habilitado:false },
    { id:'u-009',email:'planif@cajamarca.gob.pe',       password:'Planif2024!',   nombre:'Econ. Eduardo Lima Soto',rol:'gerente_sectorial',  gerencia_id:'ger-planif',gerencia_cod:'PLANIF',   activo:true,muni:'muni-cajamarca-001',mfa_habilitado:false },
    { id:'u-010',email:'oci@cajamarca.gob.pe',          password:'Oci2024!',      nombre:'CPC. Luis Mendoza V.',   rol:'oci_lectura',        gerencia_id:null,gerencia_cod:null,     activo:true,muni:'muni-cajamarca-001',mfa_habilitado:false },
    { id:'u-011',email:'asesor@cajamarca.gob.pe',        password:'Asesor2024!',   nombre:'Lic. Sofía Ramírez Díaz',rol:'asesor_despacho',    gerencia_id:null,gerencia_cod:null,     activo:true,muni:'muni-cajamarca-001',mfa_habilitado:false },
  ];

  const MockAuth = {
    async login(email, password) {
      await _delay(600);
      const user = MOCK_USERS.find(u =>
        u.email.toLowerCase() === email.toLowerCase() && u.password === password);
      if (!user) throw new Error('Credenciales incorrectas. Verifica tu correo y contraseña.');
      if (!user.activo) throw new Error('Tu cuenta está desactivada. Contacta al administrador.');
      return _buildSession(user);
    },
    async logout()         { _clearSession(); },
    async requestReset(e)  { await _delay(400); if (!MOCK_USERS.find(u=>u.email.toLowerCase()===e.toLowerCase())) throw new Error('No existe un usuario con ese correo.'); },
    // [F1 MOCK] Acepta cualquier código de 6 dígitos — NO es TOTP real
    async verifyMFA(code)  { await _delay(300); if (!/^\d{6}$/.test(code)) throw new Error('Código inválido. Usa 6 dígitos.'); return true; },
    // MFA enrollment mock — devuelve QR falso para demo UI
    async enrollMFA(userId) {
      await _delay(400);
      return {
        qr_code_url: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=otpauth://totp/KausayMunicipal:demo@cajamarca.gob.pe?secret=JBSWY3DPEHPK3PXP&issuer=KausayMunicipal`,
        secret:      'JBSWY3DPEHPK3PXP',  // secreto TOTP de demo — no usar en producción
        totp_id:     'mock-totp-' + Date.now(),
      };
    },
    async confirmEnrollMFA(totpId, code) {
      await _delay(300);
      if (!/^\d{6}$/.test(code)) throw new Error('Código incorrecto.');
      return true;
    },
    async unenrollMFA(totpId) { await _delay(200); return true; },
  };

  /* ─────────────────────────────────────────────────────────────
     SUPABASE AUTH ADAPTER — [F1][F2][F3] real
  ───────────────────────────────────────────────────────────────*/
  const SupabaseAuth = {
    _sb: null,

    init() {
      if (!window.supabase || CFG.SUPABASE_URL.startsWith('TU_')) return false;
      this._sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {
        auth: {
          persistSession:   true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey:       'kausay_sb_session',
        },
      });
      // Escuchar cambios de estado de sesión
      this._sb.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') _clearSession();
        if (event === 'TOKEN_REFRESHED' && session) _refreshSessionTTL(session);
      });
      return true;
    },

    async login(email, password) {
      const { data, error } = await this._sb.auth.signInWithPassword({ email, password });
      if (error) {
        // Mapear errores de Supabase a mensajes en español
        const msg = error.message.includes('Invalid login')
          ? 'Credenciales incorrectas. Verifica tu correo y contraseña.'
          : error.message.includes('Email not confirmed')
          ? 'Confirma tu correo antes de ingresar.'
          : error.message;
        throw new Error(msg);
      }
      const claims = _parseJWT(data.session.access_token);
      return _buildSessionFromSupabase(data.user, data.session, claims);
    },

    async logout() {
      const s = _loadSession();
      if (s) _auditLog('logout', s, { method:'explicit' });
      await this._sb.auth.signOut({ scope: 'local' });
      _clearSession();
    },

    async requestReset(email) {
      const { error } = await this._sb.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/login.html?reset=1`,
      });
      if (error) throw new Error('No se pudo enviar el correo. Contacta al administrador.');
    },

    // ── [F1] MFA TOTP REAL ─────────────────────────────────────
    // Paso 1: Enrolar TOTP — devuelve QR para configurar autenticadora
    async enrollMFA(userId) {
      const { data, error } = await this._sb.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'KausayMunicipal',
      });
      if (error) throw new Error('Error al generar QR de autenticación: ' + error.message);
      // data.totp.qr_code es un SVG; data.totp.secret es el secreto para ingreso manual
      return {
        qr_code_url: data.totp.qr_code,  // SVG string
        secret:      data.totp.secret,    // para ingreso manual en la app
        totp_id:     data.id,             // factor_id para verificar
      };
    },

    // Paso 2: Confirmar enrollamiento con el primer código
    async confirmEnrollMFA(totpId, code) {
      const { data, error } = await this._sb.auth.mfa.challengeAndVerify({
        factorId: totpId,
        code,
      });
      if (error) throw new Error('Código incorrecto. Verifica tu aplicación autenticadora.');
      // Marcar en la tabla usuarios que MFA está habilitado
      const s = _loadSession();
      if (s) {
        await this._sb.from('usuarios')
          .update({ mfa_habilitado: true })
          .eq('id', s.user_id);
      }
      return true;
    },

    // Verificación TOTP en cada login
    async verifyMFA(code) {
      // 1. Crear challenge para el factor TOTP del usuario
      const { data: factors } = await this._sb.auth.mfa.listFactors();
      const totpFactor = factors?.totp?.[0];
      if (!totpFactor) throw new Error('MFA no configurado. Configura tu aplicación autenticadora primero.');
      const { data: challenge, error: cErr } = await this._sb.auth.mfa.challenge({
        factorId: totpFactor.id,
      });
      if (cErr) throw new Error('Error al iniciar verificación MFA: ' + cErr.message);
      // 2. Verificar código
      const { error: vErr } = await this._sb.auth.mfa.verify({
        factorId:    totpFactor.id,
        challengeId: challenge.id,
        code,
      });
      if (vErr) throw new Error('Código incorrecto. Intenta nuevamente.');
      return true;
    },

    async unenrollMFA(totpId) {
      const { error } = await this._sb.auth.mfa.unenroll({ factorId: totpId });
      if (error) throw new Error('Error al eliminar MFA: ' + error.message);
      const s = _loadSession();
      if (s) await this._sb.from('usuarios').update({ mfa_habilitado: false }).eq('id', s.user_id);
      return true;
    },

    async listMFAFactors() {
      const { data } = await this._sb.auth.mfa.listFactors();
      return data?.totp || [];
    },

    // ── [F2] SESIÓN ÚNICA DEL ALCALDE ─────────────────────────
    // Estrategia: incrementar claims_version en la tabla usuarios.
    // El JWT actual dejará de ser válido cuando el hook detecte
    // que claims_version del JWT < claims_version en la tabla.
    // El desfase máximo es el TTL del JWT (1 hora por defecto en Supabase).
    async revokeOtherSessions(userId) {
      // Incrementar claims_version — el hook JWT rechazará tokens anteriores
      const { error } = await this._sb.from('usuarios')
        .update({ claims_version: Date.now() })  // usar timestamp como versión
        .eq('id', userId);
      if (error) console.warn('[Auth] revokeOtherSessions error:', error);
      // Admin API (si está disponible): forzar logout inmediato de todos los dispositivos
      // await this._sb.auth.admin.signOut(userId, 'others');
      // Esta línea requiere service_role key — solo desde Edge Function segura
      _auditLog('session_revoked', _loadSession() || {}, {
        reason: 'single_session_enforcement',
        user_id: userId,
      });
    },

    // Verificar si el claims_version del JWT aún es válido
    async isClaimsVersionValid() {
      const s = _loadSession();
      if (!s || !s.claims_version) return true;  // si no hay versión, asumir válido
      const { data } = await this._sb.from('usuarios')
        .select('claims_version').eq('id', s.user_id).single();
      if (!data) return false;
      return s.claims_version >= data.claims_version;
    },

    async refreshSession() {
      const { data, error } = await this._sb.auth.refreshSession();
      if (error) { _clearSession(); return null; }
      return data?.session || null;
    },

    async getSupabaseUser() {
      const { data } = await this._sb.auth.getUser();
      return data?.user || null;
    },
  };

  /* ─────────────────────────────────────────────────────────────
     HELPERS INTERNOS
  ───────────────────────────────────────────────────────────────*/
  function _delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  function _buildSession(user) {
    const device = _deviceFingerprint();
    const session = {
      user_id:          user.id,
      email:            user.email,
      nombre:           user.nombre,
      rol:              user.rol,
      gerencia_id:      user.gerencia_id,
      gerencia_cod:     user.gerencia_cod,
      municipalidad_id: user.muni,
      activo:           user.activo,
      created_at:       Date.now(),
      expires_at:       Date.now() + CFG.SESSION_TTL_MS,
      device,
      mfa_verified:     false,
      mfa_at:           null,
      reauth_at:        null,
      claims_version:   Date.now(),
    };
    try { localStorage.setItem(CFG.SESSION_KEY, JSON.stringify(session)); } catch(e){}
    _auditLog('login', session, { method:'email_password', device_hash: device.hash });
    _checkNewDevice(session);
    return { user, session };
  }

  function _buildSessionFromSupabase(sbUser, sbSession, claims) {
    const device = _deviceFingerprint();
    const session = {
      user_id:          sbUser.id,
      email:            sbUser.email,
      nombre:           claims.nombre || sbUser.user_metadata?.nombre || sbUser.email,
      rol:              claims.rol,
      gerencia_id:      claims.gerencia_id || null,
      gerencia_cod:     claims.gerencia_cod || null,
      municipalidad_id: claims.municipalidad_id || null,
      activo:           claims.activo !== false,
      created_at:       Date.now(),
      expires_at:       new Date(sbSession.expires_at * 1000).getTime(),
      device,
      mfa_verified:     false,
      mfa_at:           null,
      reauth_at:        null,
      supabase_token:   sbSession.access_token,
      claims_version:   claims.claims_version || Date.now(),
    };
    try { localStorage.setItem(CFG.SESSION_KEY, JSON.stringify(session)); } catch(e){}
    _auditLog('login', session, { method:'supabase_auth', device_hash: device.hash });
    _checkNewDevice(session);
    return { user: sbUser, session };
  }

  function _refreshSessionTTL(sbSession) {
    const s = _loadSession();
    if (!s) return;
    s.expires_at     = new Date(sbSession.expires_at * 1000).getTime();
    s.supabase_token = sbSession.access_token;
    try { localStorage.setItem(CFG.SESSION_KEY, JSON.stringify(s)); } catch(e){}
  }

  function _loadSession() {
    try { const r=localStorage.getItem(CFG.SESSION_KEY); return r?JSON.parse(r):null; }
    catch(e) { return null; }
  }

  function _clearSession() {
    try { localStorage.removeItem(CFG.SESSION_KEY); } catch(e){}
    sessionStorage.clear();
  }

  function _parseJWT(token) {
    try { return JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); }
    catch(e) { return {}; }
  }

  function _syncToSessionStorage(session) {
    if (!session) return;
    sessionStorage.setItem('kausay_demo_rol',       session.rol);
    sessionStorage.setItem('kausay_demo_nombre',    session.nombre);
    sessionStorage.setItem('kausay_demo_gerencia',  session.gerencia_cod || '');
    sessionStorage.setItem('kausay_uid',            session.user_id);
    sessionStorage.setItem('kausay_muni_id',        session.municipalidad_id || '');
  }

  /* ─────────────────────────────────────────────────────────────
     [F3] DEVICE FINGERPRINT Y DETECCIÓN DE DISPOSITIVO NUEVO
  ───────────────────────────────────────────────────────────────*/
  function _deviceFingerprint() {
    const ua    = navigator.userAgent;
    const lang  = navigator.language || '';
    const tz    = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const mobile = /Mobi|Android|iPhone/i.test(ua) ? 'mobile' : 'desktop';
    // Hash determinístico basado en user-agent + idioma + timezone
    // No identifica al usuario — identifica configuración del browser/OS
    let h = 0;
    const str = ua + lang + tz;
    for (let i=0; i<str.length; i++) h = ((h<<5)-h)+str.charCodeAt(i)|0;
    return {
      type:     mobile,
      hash:     Math.abs(h).toString(36),
      platform: navigator.platform || 'unknown',
      tz,
      lang,
    };
  }

  // Registrar dispositivo y detectar si es nuevo
  function _checkNewDevice(session) {
    if (!session?.user_id) return;
    const key   = `${CFG.DEVICES_KEY}:${session.user_id}`;
    let devices = [];
    try { devices = JSON.parse(localStorage.getItem(key) || '[]'); } catch(e){}
    const hash    = session.device?.hash;
    const known   = devices.find(d => d.hash === hash);
    const isNew   = !known;

    if (isNew) {
      // Registrar dispositivo nuevo
      devices.push({
        hash,
        type:      session.device?.type,
        platform:  session.device?.platform,
        tz:        session.device?.tz,
        first_seen:new Date().toISOString(),
        last_seen: new Date().toISOString(),
      });
      // Mantener solo los últimos 10 dispositivos conocidos
      if (devices.length > 10) devices.splice(0, devices.length - 10);
      try { localStorage.setItem(key, JSON.stringify(devices)); } catch(e){}

      // Registrar en audit
      _auditLog('new_device_detected', session, {
        device_hash:  hash,
        device_type:  session.device?.type,
        platform:     session.device?.platform,
      });

      // Emitir evento para que el dashboard pueda mostrar notificación
      window.dispatchEvent(new CustomEvent('kausay:new_device', {
        detail: { device: session.device, user: session.nombre, rol: session.rol }
      }));

      // Para el alcalde: notificación más prominente
      if (CFG.SINGLE_SESSION_ROLES.includes(session.rol)) {
        window.dispatchEvent(new CustomEvent('kausay:high_risk_new_device', {
          detail: { device: session.device, session }
        }));
      }
    } else {
      // Actualizar last_seen
      known.last_seen = new Date().toISOString();
      try { localStorage.setItem(key, JSON.stringify(devices)); } catch(e){}
    }

    return isNew;
  }

  function _getKnownDevices(userId) {
    try {
      const key = `${CFG.DEVICES_KEY}:${userId}`;
      return JSON.parse(localStorage.getItem(key) || '[]');
    } catch(e) { return []; }
  }

  /* ─────────────────────────────────────────────────────────────
     [F5] AUDIT LOG — todos los eventos de acceso
  ───────────────────────────────────────────────────────────────*/
  function _auditLog(accion, session, meta={}) {
    const entry = {
      accion,
      usuario_id:       session?.user_id  || 'unknown',
      email:            session?.email    || 'unknown',
      rol:              session?.rol      || 'unknown',
      municipalidad_id: session?.municipalidad_id || 'unknown',
      device_hash:      session?.device?.hash || null,
      device_type:      session?.device?.type || null,
      user_agent:       navigator.userAgent.slice(0, 200),
      timestamp:        new Date().toISOString(),
      ...meta,
    };

    // 1. Buffer local (siempre, como backup)
    try {
      const log = JSON.parse(localStorage.getItem(CFG.AUDIT_KEY) || '[]');
      log.push(entry);
      if (log.length > 300) log.splice(0, log.length - 300);
      localStorage.setItem(CFG.AUDIT_KEY, JSON.stringify(log));
    } catch(e){}

    // 2. Supabase audit table (cuando disponible)
    if (CFG.USE_SUPABASE && SupabaseAuth._sb) {
      SupabaseAuth._sb.rpc('registrar_evento', {
        p_entidad_tipo:  'auth',
        p_entidad_id:    entry.usuario_id,
        p_entidad_label: entry.email,
        p_accion:        accion,
        p_before_state:  null,
        p_after_state:   JSON.parse(JSON.stringify({ ...meta, device_hash: entry.device_hash })),
      }).catch(e => console.warn('[Auth Audit]', e));
    }
  }

  /* ─────────────────────────────────────────────────────────────
     ADAPTER ACTIVO
  ───────────────────────────────────────────────────────────────*/
  const Adapter = CFG.USE_SUPABASE ? SupabaseAuth : MockAuth;
  if (CFG.USE_SUPABASE) SupabaseAuth.init();

  /* ─────────────────────────────────────────────────────────────
     API PÚBLICA
  ───────────────────────────────────────────────────────────────*/
  return {

    /* ── Login ── */
    async login(email, password) {
      const result = await Adapter.login(email, password);
      _syncToSessionStorage(result.session);

      // [F2] Sesión única para alcalde — revocar otras
      if (CFG.USE_SUPABASE && CFG.SINGLE_SESSION_ROLES.includes(result.session.rol)) {
        await SupabaseAuth.revokeOtherSessions(result.session.user_id);
      }
      return result;
    },

    /* ── Logout ── */
    async logout() {
      const s = _loadSession();
      if (s) _auditLog('logout', s, { initiated_by: 'user' });
      await Adapter.logout();
      sessionStorage.clear();
      window.location.href = 'login.html';
    },

    /* ── Estado de sesión ── */
    getSession()      { return _loadSession(); },
    isSessionValid()  {
      const s = _loadSession();
      return !!(s && Date.now() < s.expires_at && s.activo !== false);
    },

    /* ── [F1] MFA — Enrolamiento ── */
    async startMFAEnrollment() {
      const s = _loadSession();
      if (!s) throw new Error('Sesión requerida para configurar MFA.');
      const data = await Adapter.enrollMFA(s.user_id);
      // data = { qr_code_url, secret, totp_id }
      _auditLog('mfa_enrollment_started', s, { totp_id: data.totp_id });
      return data;
    },

    async confirmMFAEnrollment(totpId, code) {
      const s = _loadSession();
      const ok = await Adapter.confirmEnrollMFA(totpId, code);
      if (ok) {
        if (s) {
          s.mfa_habilitado = true;
          try { localStorage.setItem(CFG.SESSION_KEY, JSON.stringify(s)); } catch(e){}
          _auditLog('mfa_enrolled', s, { totp_id: totpId });
        }
      }
      return ok;
    },

    async removeMFA(totpId) {
      const s = _loadSession();
      const ok = await Adapter.unenrollMFA(totpId);
      if (ok && s) _auditLog('mfa_removed', s, { totp_id: totpId });
      return ok;
    },

    async listMFAFactors() {
      if (CFG.USE_SUPABASE) return await SupabaseAuth.listMFAFactors();
      return [];  // demo: no hay factores reales
    },

    isMFAEnrolled() {
      const s = _loadSession();
      return !!(s?.mfa_habilitado);
    },

    /* ── [F1] MFA — Verificación en login ── */
    async verifyMFA(code) {
      const ok = await Adapter.verifyMFA(code);
      if (ok) {
        const s = _loadSession();
        if (s) {
          s.mfa_verified = true;
          s.mfa_at = Date.now();
          try { localStorage.setItem(CFG.SESSION_KEY, JSON.stringify(s)); } catch(e){}
          _auditLog('mfa_verified', s, {});
        }
      }
      return ok;
    },

    requiresMFA(rol) { return CFG.MFA_ROLES.includes(rol); },

    /* ── [F2] Validar vigencia de claims_version ── */
    async isClaimsVersionValid() {
      if (!CFG.USE_SUPABASE) return true;
      return await SupabaseAuth.isClaimsVersionValid();
    },

    /* ── [F3] Dispositivos ── */
    getKnownDevices()  { const s=_loadSession(); return s?_getKnownDevices(s.user_id):[]; },
    getCurrentDevice() { return _deviceFingerprint(); },
    isCurrentDeviceKnown() {
      const s = _loadSession();
      if (!s) return false;
      const devices = _getKnownDevices(s.user_id);
      const hash = _deviceFingerprint().hash;
      return devices.some(d => d.hash === hash);
    },

    /* ── requireAuth ── */
    requireAuth(rolesPermitidos=null) {
      const s = _loadSession();
      if (!s)                         { window.location.href='login.html'; return; }
      if (Date.now()>s.expires_at)    { _clearSession(); window.location.href='login.html'; return; }
      if (s.activo===false)           { _clearSession(); window.location.href='login.html'; return; }
      _syncToSessionStorage(s);
      if (rolesPermitidos && !rolesPermitidos.includes(s.rol)) {
        window.location.href='login.html?error=no_autorizado'; return;
      }
      if (this.requiresMFA(s.rol) && !s.mfa_verified) {
        window.location.href=`login.html?mfa=1&redirect=${encodeURIComponent(window.location.href)}`; return;
      }
      if (s.rol==='gerente_sectorial' && !s.gerencia_cod) {
        window.location.href='login.html?error=sin_gerencia'; return;
      }
      // [F2] Validar claims_version en background (no bloquea el render)
      if (CFG.USE_SUPABASE) {
        this.isClaimsVersionValid().then(valid => {
          if (!valid) {
            _auditLog('session_invalidated', s, { reason:'claims_version_mismatch' });
            _clearSession();
            window.location.href='login.html?error=sesion_invalidada';
          }
        }).catch(()=>{});
      }
    },

    /* ── redirectByRole ── */
    redirectByRole(session) {
      const s = session || _loadSession();
      if (!s) { window.location.href='login.html'; return; }
      _syncToSessionStorage(s);
      const dest   = CFG.REDIRECT_MAP[s.rol] || 'index.html';
      const params = new URLSearchParams({
        rol:    s.rol,
        nombre: s.nombre,
        ...(s.gerencia_cod?{gerencia:s.gerencia_cod}:{}),
      });
      window.location.href=`${dest}?${params}`;
    },

    /* ── [F4] Reauth ── */
    async reauth(motivo='') {
      const s = _loadSession();
      if (!s) return false;
      // Si reautenticó hace menos de 15 min, no pedir de nuevo
      if (s.reauth_at && (Date.now()-s.reauth_at)<CFG.REAUTH_TTL_MS) return true;

      const event = new CustomEvent('kausay:reauth_required', {
        detail: { motivo, user_id:s.user_id, rol:s.rol, email:s.email }
      });
      window.dispatchEvent(event);

      return new Promise(resolve => {
        const handler = e => {
          window.removeEventListener('kausay:reauth_done', handler);
          const ok = e.detail?.success===true;
          if (ok) {
            const s2=_loadSession();
            if (s2) { s2.reauth_at=Date.now(); try{localStorage.setItem(CFG.SESSION_KEY,JSON.stringify(s2));}catch(ex){} }
            _auditLog('reauth_success', s, { motivo });
          } else {
            _auditLog('reauth_failed', s, { motivo, reason: e.detail?.error||'cancelled' });
          }
          resolve(ok);
        };
        window.addEventListener('kausay:reauth_done', handler);
        setTimeout(()=>{ window.removeEventListener('kausay:reauth_done',handler); resolve(false); }, 90_000);
      });
    },

    async confirmReauth(password) {
      const s = _loadSession();
      if (!s) { window.dispatchEvent(new CustomEvent('kausay:reauth_done',{detail:{success:false}})); return; }
      try {
        await Adapter.login(s.email, password);
        window.dispatchEvent(new CustomEvent('kausay:reauth_done',{detail:{success:true}}));
      } catch(e) {
        window.dispatchEvent(new CustomEvent('kausay:reauth_done',{detail:{success:false,error:e.message}}));
      }
    },

    /* ── Reset contraseña ── */
    async requestPasswordReset(email) {
      await Adapter.requestReset(email);
      _auditLog('password_reset_requested',
        {user_id:'unknown',email,municipalidad_id:'unknown',device:_deviceFingerprint()}, {});
    },

    /* ── [F2] Revocar sesión ── */
    async revokeSession() {
      const s = _loadSession();
      _auditLog('session_revoked', s||{}, {reason:'manual_revoke'});
      if (CFG.USE_SUPABASE && s) await SupabaseAuth.revokeOtherSessions(s.user_id);
      await Adapter.logout();
      sessionStorage.clear();
    },

    /* ── Registro de intento fallido ── */
    recordFailedAttempt(email) {
      _auditLog('login_failed',
        {user_id:'unknown',email,municipalidad_id:'unknown',device:_deviceFingerprint()},
        {reason:'invalid_credentials'});
    },

    /* ── Audit log ── */
    getAuditLog() {
      try { return JSON.parse(localStorage.getItem(CFG.AUDIT_KEY)||'[]'); } catch(e) { return []; }
    },

    /* ── Constantes públicas ── */
    REAUTH_ACTIONS: CFG.REAUTH_ACTIONS,
    MFA_ROLES:      CFG.MFA_ROLES,
    MFA_RECOMMENDED:CFG.MFA_RECOMMENDED,
    CFG,
  };
})();
