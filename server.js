const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('./database');
const dian = require('./dian');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : null;

const FONDO_UPLOAD_DIR = DATA_DIR
  ? path.join(DATA_DIR, 'uploads', 'fondos')
  : path.join(__dirname, 'public', 'uploads', 'fondos');
const LOGO_UPLOAD_DIR = DATA_DIR
  ? path.join(DATA_DIR, 'uploads', 'logos')
  : path.join(__dirname, 'public', 'uploads', 'logos');
if (!fs.existsSync(FONDO_UPLOAD_DIR)) {
  fs.mkdirSync(FONDO_UPLOAD_DIR, { recursive: true });
}
if (!fs.existsSync(LOGO_UPLOAD_DIR)) {
  fs.mkdirSync(LOGO_UPLOAD_DIR, { recursive: true });
}
const storageFondo = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, FONDO_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
    cb(null, `fondo-${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
  }
});
const uploadFondo = multer({
  storage: storageFondo,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if ((file.mimetype || '').startsWith('image/')) {
      return cb(null, true);
    }
    cb(new Error('Solo se permiten archivos de imagen.'));
  }
});
const storageLogo = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, LOGO_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'].includes(ext) ? ext : '.png';
    cb(null, `logo-${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
  }
});
const uploadLogo = multer({
  storage: storageLogo,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if ((file.mimetype || '').startsWith('image/')) {
      return cb(null, true);
    }
    cb(new Error('Solo se permiten archivos de imagen.'));
  }
});

// Middleware
app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
      return callback(null, true);
    }
    // Permite el mismo dominio en producción (Render, etc.)
    if (IS_PRODUCTION && /^https:\/\/.+/i.test(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true
}));

if (IS_PRODUCTION) {
  app.set('trust proxy', 1);
}
app.use(cookieParser());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Configuración de sesiones
app.use(session({
  secret: process.env.SESSION_SECRET || 'hotel-reservas-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: IS_PRODUCTION,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 24 horas
  }
}));

// Middleware de autenticación
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  } else {
    return res.status(401).json({ error: 'No autorizado. Debe iniciar sesión.' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'No autorizado. Debe iniciar sesión.' });
  }
  const rol = db.normalizarRolUsuario(req.session.rol, req.session.username);
  req.session.rol = rol;
  if (rol !== 'administrador') {
    return res.status(403).json({ error: 'Se requieren permisos de administrador.' });
  }
  next();
}

// ========== RUTAS DE AUTENTICACIÓN (sin protección) ==========
app.post('/api/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '').trim();

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
  }

  db.getUserByUsername(username, (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Error en el servidor' });
    }
    
    if (!user) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    if (!db.usuarioEstaActivo(user.activo)) {
      return res.status(403).json({
        error:
          'Esta cuenta está anulada y no puede iniciar sesión. Un administrador debe reactivarla en Configuración. ' +
          'Nota: el rol Operador sí permite entrar al sistema cuando la cuenta está activa.'
      });
    }
    
    db.verifyPassword(password, user.password, user.password_sha256_ci, (err, isValid) => {
      if (err) {
        return res.status(500).json({ error: 'Error en el servidor' });
      }
      
      if (!isValid) {
        return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
      }

      // Administradores y operadores: normaliza el hash para clave sin mayúsculas.
      db.syncPasswordHashNormalized(user.id, password, () => {});

      const rol = db.normalizarRolUsuario(user.rol, user.username);

      // Crear sesión
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.nombre = user.nombre;
      req.session.rol = rol;

      // Actualizar último acceso
      db.updateLastAccess(user.id, () => {});

      req.session.save((saveErr) => {
        if (saveErr) {
          return res.status(500).json({ error: 'No se pudo guardar la sesión. Intente de nuevo.' });
        }
        res.json({
          message: 'Login exitoso',
          user: {
            id: user.id,
            username: user.username,
            nombre: user.nombre,
            rol,
            activo: db.usuarioEstaActivo(user.activo) ? 1 : 0
          }
        });
      });
    });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Error al cerrar sesión' });
    }
    res.clearCookie('connect.sid');
    res.json({ message: 'Sesión cerrada exitosamente' });
  });
});

app.get('/api/auth/check', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.json({ authenticated: false });
  }
  db.getUserById(req.session.userId, (err, u) => {
    if (err || !u) {
      req.session.destroy(() => {});
      return res.json({ authenticated: false });
    }
    if (!db.usuarioEstaActivo(u.activo)) {
      req.session.destroy(() => {});
      return res.json({ authenticated: false, error: 'Cuenta anulada' });
    }
    const rol = db.normalizarRolUsuario(u.rol, u.username);
    req.session.rol = rol;
    req.session.username = u.username;
    req.session.nombre = u.nombre;
    res.json({
      authenticated: true,
      user: {
        id: u.id,
        username: u.username,
        nombre: u.nombre,
        rol,
        activo: db.usuarioEstaActivo(u.activo) ? 1 : 0
      }
    });
  });
});

// Cambiar contraseña del usuario autenticado (cualquier rol)
app.put('/api/auth/mi-password', requireAuth, (req, res) => {
  const { password_actual, password_nueva } = req.body;
  if (!password_actual || !password_nueva) {
    return res.status(400).json({ error: 'Contraseña actual y nueva son requeridas' });
  }
  if (String(password_nueva).length < 6) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
  }
  db.getUserById(req.session.userId, (err, user) => {
    if (err || !user) {
      return res.status(500).json({ error: 'Usuario no encontrado' });
    }
    db.verifyPassword(password_actual, user.password, user.password_sha256_ci, (err, ok) => {
      if (err || !ok) {
        return res.status(400).json({ error: 'La contraseña actual no es correcta' });
      }
      db.updateUserPasswordById(user.id, password_nueva, (err) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        res.json({ message: 'Contraseña actualizada' });
      });
    });
  });
});

// ========== ADMINISTRACIÓN DE USUARIOS (solo administrador) ==========
app.get('/api/usuarios', requireAdmin, (req, res) => {
  db.getAllUsers((err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

app.post('/api/usuarios', requireAdmin, (req, res) => {
  const { username, password, nombre, email, rol } = req.body;
  if (!username || !String(username).trim() || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }
  const r = rol === 'administrador' ? 'administrador' : 'operador';
  db.createUser(
    String(username).trim(),
    password,
    nombre || '',
    email || '',
    r,
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.status(201).json(row);
    }
  );
});

app.put('/api/usuarios/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { nombre, email, rol } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  const nuevoRol = rol === 'administrador' ? 'administrador' : 'operador';

  db.getUserById(id, (err, usuario) => {
    if (err || !usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const eraAdmin = usuario.rol === 'administrador';
    const quitaAdmin = eraAdmin && nuevoRol === 'operador';

    if (quitaAdmin) {
      db.countAdminsActiveExcept(id, (e2, row) => {
        if (e2) {
          return res.status(500).json({ error: e2.message });
        }
        if (!row || row.c < 1) {
          return res.status(400).json({
            error: 'Debe existir al menos otro administrador activo antes de cambiar este rol.'
          });
        }
        aplicarUpdateUsuario();
      });
    } else {
      aplicarUpdateUsuario();
    }

    function aplicarUpdateUsuario() {
      db.updateUserDatos(id, nombre, email, nuevoRol, (err2) => {
        if (err2) {
          return res.status(500).json({ error: err2.message });
        }
        if (req.session.userId === id) {
          req.session.rol = nuevoRol;
        }
        res.json({ message: 'Usuario actualizado' });
      });
    }
  });
});

app.put('/api/usuarios/:id/password', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { password_nueva } = req.body;
  if (!id || !password_nueva) {
    return res.status(400).json({ error: 'ID y contraseña nueva son requeridos' });
  }
  if (String(password_nueva).length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }
  db.getUserById(id, (err, u) => {
    if (err || !u) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    db.updateUserPasswordById(id, password_nueva, (err2) => {
      if (err2) {
        return res.status(500).json({ error: err2.message });
      }
      res.json({ message: 'Contraseña restablecida' });
    });
  });
});

app.put('/api/usuarios/:id/activo', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { activo } = req.body;
  if (!id || (activo !== 0 && activo !== 1 && activo !== true && activo !== false)) {
    return res.status(400).json({ error: 'activo debe ser 0 o 1' });
  }
  const activar = activo === 1 || activo === true;

  if (!activar && req.session.userId === id) {
    return res.status(400).json({ error: 'No puede anular su propia cuenta.' });
  }

  db.getUserById(id, (err, usuario) => {
    if (err || !usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (!activar && usuario.rol === 'administrador') {
      db.countAdminsActiveExcept(id, (e2, row) => {
        if (e2) {
          return res.status(500).json({ error: e2.message });
        }
        if (!row || row.c < 1) {
          return res.status(400).json({
            error: 'No puede anular al único administrador activo del sistema.'
          });
        }
        db.setUserActivo(id, 0, (e3) => {
          if (e3) {
            return res.status(500).json({ error: e3.message });
          }
          res.json({ message: 'Cuenta anulada', activo: 0 });
        });
      });
    } else {
      db.setUserActivo(id, activar ? 1 : 0, (e3) => {
        if (e3) {
          return res.status(500).json({ error: e3.message });
        }
        res.json({
          message: activar ? 'Cuenta reactivada' : 'Cuenta anulada',
          activo: activar ? 1 : 0
        });
      });
    }
  });
});

/** Colores de tema en hex (#RGB, #RRGGBB o #RRGGBBAA). */
function normalizeHexColor(input) {
  if (input == null) return null;
  let s = String(input).trim();
  if (/^#[0-9A-Fa-f]{8}$/.test(s)) {
    s = '#' + s.slice(1, 7);
  }
  if (!/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(s)) return null;
  if (s.length === 4) {
    return (
      '#' +
      s[1].toLowerCase().repeat(2) +
      s[2].toLowerCase().repeat(2) +
      s[3].toLowerCase().repeat(2)
    );
  }
  return s.toLowerCase();
}

/** Fondo permitido: URL absoluta http/https o ruta local desde /public iniciando por /. */
function normalizeBackgroundImageUrl(input) {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;
  if (s.startsWith('/')) return s;
  if (/^https?:\/\/[^\s]+$/i.test(s)) return s;
  return null;
}

/** Estado del servidor y conexión a la base de datos. */
app.get('/api/status', (req, res) => {
  const dbInfo = db.getDatabaseInfo();
  db.pingDatabase((err) => {
    res.json({
      ok: !err && dbInfo.connected,
      version: 3,
      database: {
        connected: dbInfo.connected && !err,
        path: dbInfo.path,
        dataDir: dbInfo.dataDir,
        fileExists: dbInfo.exists,
        error: err ? err.message : null
      },
      features: ['hotel-tema-put', 'reservas-put', 'sqlite-data-dir']
    });
  });
});

/** Nombre del establecimiento (público, para login sin sesión). */
app.get('/api/hotel/nombre', (req, res) => {
  db.getHotel((err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ nombre: (row && row.nombre) ? String(row.nombre).trim() : 'Mi Hotel' });
  });
});

// Paleta y nombre para login y vistas sin sesión.
app.get('/api/hotel/apariencia', (req, res) => {
  db.getHotel((err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.json({
        nombre: 'Mi Hotel',
        color_primario: null,
        color_secundario: null,
        color_acento: null,
        color_titulo: null,
        fondo_imagen_url: null,
        logo_url: null
      });
    }
    res.json({
      nombre: row.nombre || 'Mi Hotel',
      color_primario: row.color_primario || null,
      color_secundario: row.color_secundario || null,
      color_acento: row.color_acento || null,
      color_titulo: row.color_titulo || null,
      fondo_imagen_url: row.fondo_imagen_url || null,
      logo_url: row.logo_url || null
    });
  });
});

// ========== RUTAS PROTEGIDAS (requieren autenticación) ==========
// ========== RUTAS DEL HOTEL ==========
app.get('/api/hotel', requireAuth, (req, res) => {
  db.getHotel((err, hotel) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(hotel || { nombre: 'Mi Hotel' });
    }
  });
});

/** Actualizar colores del tema (cualquier usuario autenticado; en la UI solo lo ve el administrador). */
app.put('/api/hotel/tema', requireAuth, (req, res) => {
  const body = req.body || {};

  if (body.reiniciar === true || body.reiniciar === 'true' || body.reiniciar === 1) {
    db.updateHotelApariencia(null, null, null, null, null, (err) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      db.updateHotelLogoUrl(null, (errLogo) => {
        if (errLogo) {
          return res.status(500).json({ error: errLogo.message });
        }
        return res.json({
          message: 'Apariencia restaurada a los predeterminados',
          reiniciar: true
        });
      });
    });
    return;
  }

  db.ensureHotelRow((err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(500).json({ error: 'No se pudo inicializar la configuración del hotel' });
    }

    const keys = ['color_primario', 'color_secundario', 'color_acento', 'color_titulo'];
    const next = keys.map((k) => row[k] || null);
    let fondoImagenUrl = row.fondo_imagen_url || null;

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (!(key in body)) continue;
      const raw = body[key];
      if (raw === null || raw === '') {
        next[i] = null;
        continue;
      }
      const norm = normalizeHexColor(raw);
      if (!norm) {
        return res.status(400).json({
          error: `El color "${key}" debe ser un hexadecimal válido (#RGB o #RRGGBB).`
        });
      }
      next[i] = norm;
    }

    if ('fondo_imagen_url' in body) {
      const fondoRaw = body.fondo_imagen_url;
      if (fondoRaw === null || String(fondoRaw).trim() === '') {
        fondoImagenUrl = null;
      } else {
        const fondoNorm = normalizeBackgroundImageUrl(fondoRaw);
        if (!fondoNorm) {
          return res.status(400).json({
            error: 'fondo_imagen_url debe ser URL http/https o ruta local iniciando por /.'
          });
        }
        fondoImagenUrl = fondoNorm;
      }
    }

    const aplicarRespuestaTema = (logoUrl) => {
      res.json({
        message: 'Colores actualizados',
        color_primario: next[0],
        color_secundario: next[1],
        color_acento: next[2],
        color_titulo: next[3],
        fondo_imagen_url: fondoImagenUrl,
        logo_url: logoUrl != null ? logoUrl : row.logo_url || null
      });
    };

    const guardarColores = (logoUrlFinal) => {
      db.updateHotelApariencia(next[0], next[1], next[2], next[3], fondoImagenUrl, (err2) => {
        if (err2) {
          return res.status(500).json({ error: err2.message });
        }
        aplicarRespuestaTema(logoUrlFinal);
      });
    };

    if ('logo_url' in body) {
      const logoRaw = body.logo_url;
      if (logoRaw === null || String(logoRaw).trim() === '') {
        return db.updateHotelLogoUrl(null, (errLogo) => {
          if (errLogo) {
            return res.status(500).json({ error: errLogo.message });
          }
          guardarColores(null);
        });
      }
      const logoNorm = normalizeBackgroundImageUrl(logoRaw);
      if (!logoNorm) {
        return res.status(400).json({
          error: 'logo_url debe ser URL http/https o ruta local iniciando por /.'
        });
      }
      return db.updateHotelLogoUrl(logoNorm, (errLogo) => {
        if (errLogo) {
          return res.status(500).json({ error: errLogo.message });
        }
        guardarColores(logoNorm);
      });
    }

    guardarColores(row.logo_url || null);
  });
});

/** Vistas del inventario: tarjetas | lista | tabla (solo administrador en la UI). */
app.put('/api/hotel/vistas', requireAuth, requireAdmin, (req, res) => {
  const allowed = ['tarjetas', 'lista', 'tabla'];
  const body = req.body || {};
  const rawH = body.vista_habitaciones != null ? String(body.vista_habitaciones).trim().toLowerCase() : '';
  const rawC = body.vista_chinchorros != null ? String(body.vista_chinchorros).trim().toLowerCase() : '';
  if (!allowed.includes(rawH) || !allowed.includes(rawC)) {
    return res.status(400).json({
      error: 'Cada vista debe ser: tarjetas, lista o tabla.'
    });
  }
  db.updateHotelVistas(rawH, rawC, (err) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({
      message: 'Vistas guardadas',
      vista_habitaciones: rawH,
      vista_chinchorros: rawC
    });
  });
});

/** Subir logotipo desde archivo local (admin). */
app.post('/api/hotel/logo-upload', requireAuth, requireAdmin, (req, res) => {
  uploadLogo.single('logo')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'El logotipo supera el límite de 2MB.' });
      }
      return res.status(400).json({ error: err.message || 'No se pudo subir el logotipo.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Debe seleccionar una imagen.' });
    }
    const logoUrl = `/uploads/logos/${req.file.filename}`;
    db.updateHotelLogoUrl(logoUrl, (eSave) => {
      if (eSave) {
        return res.status(500).json({ error: eSave.message });
      }
      res.json({ message: 'Logotipo cargado', logo_url: logoUrl });
    });
  });
});

/** Subir imagen de fondo desde archivo local (admin). */
app.post('/api/hotel/fondo-upload', requireAuth, requireAdmin, (req, res) => {
  uploadFondo.single('fondo')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'La imagen supera el límite de 5MB.' });
      }
      return res.status(400).json({ error: err.message || 'No se pudo subir la imagen.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Debe seleccionar una imagen.' });
    }
    const fondoUrl = `/uploads/fondos/${req.file.filename}`;
    db.ensureHotelRow((eRow, row) => {
      if (eRow || !row) {
        return res.status(500).json({ error: eRow ? eRow.message : 'No se pudo preparar hotel' });
      }
      db.updateHotelApariencia(
        row.color_primario || null,
        row.color_secundario || null,
        row.color_acento || null,
        row.color_titulo || null,
        fondoUrl,
        (eSave) => {
          if (eSave) {
            return res.status(500).json({ error: eSave.message });
          }
          res.json({ message: 'Imagen de fondo cargada', fondo_imagen_url: fondoUrl });
        }
      );
    });
  });
});

app.put('/api/hotel', requireAuth, (req, res) => {
  const { nombre } = req.body;
  if (!nombre) {
    return res.status(400).json({ error: 'El nombre del hotel es requerido' });
  }
  db.updateHotelNombre(nombre, (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ message: 'Nombre del hotel actualizado', nombre });
    }
  });
});

function parsePrecioDiario(body) {
  const v = body && body.precio_diario;
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function parseTarifaNoche(body) {
  const v = body && (body.tarifa_noche != null ? body.tarifa_noche : body.precio_diario);
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Número interno obligatorio en BD; el formulario no lo pide — se conserva o se genera. */
function numeroHabitacionInventario(hab, id, nombreSeguro) {
  const candidatos = [
    hab && hab.numero,
    hab && hab.codigo,
    nombreSeguro,
    id != null ? `HAB-${id}` : null
  ];
  for (const c of candidatos) {
    const s = c != null ? String(c).trim() : '';
    if (s) return s;
  }
  return 'HAB-1';
}

function numeroChinchorroInventario(ch, id, nombreSeguro) {
  const candidatos = [
    ch && ch.numero,
    ch && ch.codigo,
    nombreSeguro,
    id != null ? `CH-${id}` : null
  ];
  for (const c of candidatos) {
    const s = c != null ? String(c).trim() : '';
    if (s) return s;
  }
  return 'CH-1';
}

function generarIdentificadoresHabitacion(nombre, callback) {
  const nom = String(nombre || '').trim();
  if (!nom) {
    return callback(new Error('El nombre de la habitación es requerido'));
  }
  db.db.get('SELECT MAX(id) as maxId FROM habitaciones', (err, row) => {
    if (err) return callback(err);
    const next = (row && row.maxId ? Number(row.maxId) : 0) + 1;
    const codigo = `HAB-${next}`;
    const numero = `HAB-${next}`;
    callback(null, codigo, numero, nom);
  });
}

function parseTarifaDia(body) {
  const v = body && (body.tarifa_dia != null ? body.tarifa_dia : body.precio_diario);
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function parseMontoAbonado(body) {
  const v = body && (body.monto != null ? body.monto : body.monto_abonado);
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Estado al guardar desde Modificar: permite limpieza y fuera de servicio; no devuelve error por Ocupada/Reservada. */
function resolverEstadoInventarioModificar(habActual, estadoSolicitado, conReservaHoy) {
  const estadosValidos = ['Disponible', 'Ocupada', 'Reservada', 'En limpieza', 'Fuera de servicio'];
  const est = estadosValidos.includes(String(estadoSolicitado)) ? String(estadoSolicitado) : 'Disponible';
  const manual = ['Disponible', 'En limpieza', 'Fuera de servicio'];
  if (manual.includes(est)) {
    if (conReservaHoy && est === 'Disponible') {
      return 'Ocupada';
    }
    return est;
  }
  if (est === 'Ocupada' || est === 'Reservada') {
    if (conReservaHoy) return 'Ocupada';
    return String((habActual && habActual.estado) || 'Disponible');
  }
  return 'Disponible';
}

function generarIdentificadoresChinchorro(nombre, callback) {
  const nom = String(nombre || '').trim();
  if (!nom) {
    return callback(new Error('El nombre del chinchorro es requerido'));
  }
  db.db.get('SELECT MAX(id) as maxId FROM chinchorros', (err, row) => {
    if (err) return callback(err);
    const next = (row && row.maxId ? Number(row.maxId) : 0) + 1;
    const codigo = `CH-${next}`;
    const numero = `CH-${next}`;
    callback(null, codigo, numero, nom);
  });
}

// ========== INVENTARIO (sincronización con reservas) ==========
app.post('/api/inventario/sincronizar-estados', requireAuth, (req, res) => {
  db.sincronizarTodosEstadosInventario((err) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ message: 'Estados de habitaciones y chinchorros sincronizados con reservas activas' });
    }
  });
});

// ========== RUTAS DE HABITACIONES ==========
app.get('/api/habitaciones', requireAuth, (req, res) => {
  db.getAllHabitaciones((err, habitaciones) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(habitaciones);
    }
  });
});

app.post('/api/habitaciones', requireAuth, (req, res) => {
  const { nombre, tipo, piso, estado } = req.body;
  const estadosValidos = ['Disponible', 'Ocupada', 'Reservada', 'En limpieza', 'Fuera de servicio'];
  const estadoSeguro = estadosValidos.includes(String(estado)) ? String(estado) : 'Disponible';
  generarIdentificadoresHabitacion(nombre, (errId, codigo, numero, nombreSeguro) => {
    if (errId) {
      return res.status(400).json({ error: errId.message });
    }
    db.createHabitacion(
      codigo,
      numero,
      nombreSeguro,
      tipo || 'Sencilla',
      piso ? String(piso).trim() : '',
      estadoSeguro,
      0,
      (err, habitacion) => {
        if (err) {
          res.status(500).json({ error: err.message });
        } else {
          res.status(201).json(habitacion);
        }
      }
    );
  });
});

app.put('/api/habitaciones/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { nombre, tipo, piso, estado } = req.body;
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  const nombreSeguro = nombre != null ? String(nombre).trim() : '';
  if (!nombreSeguro) {
    return res.status(400).json({ error: 'El nombre de la habitación es requerido' });
  }
  const estadosValidos = ['Disponible', 'Ocupada', 'Reservada', 'En limpieza', 'Fuera de servicio'];
  const estadoSeguro = estadosValidos.includes(String(estado)) ? String(estado) : 'Disponible';
  db.habitacionTieneReservaActivaHoy(id, (errRes, conReserva) => {
    if (errRes) {
      return res.status(500).json({ error: errRes.message });
    }
    db.getHabitacionById(id, (errHab, hab) => {
      if (errHab) {
        return res.status(500).json({ error: errHab.message });
      }
      if (!hab) {
        return res.status(404).json({ error: 'Habitación no encontrada' });
      }
      const estadoFinal = resolverEstadoInventarioModificar(hab, estadoSeguro, conReserva);
      const codigo = (hab.codigo && String(hab.codigo).trim()) || `HAB-${id}`;
      const numero = numeroHabitacionInventario(hab, id, nombreSeguro);
      const precio = hab.precio_diario != null ? Number(hab.precio_diario) : 0;
      db.updateHabitacionDatos(
        id,
        codigo,
        numero,
        nombreSeguro,
        tipo || 'Sencilla',
        piso ? String(piso).trim() : '',
        estadoFinal,
        precio,
        (err) => {
          if (err) {
            res.status(500).json({ error: err.message });
          } else {
            res.json({ message: 'Habitación actualizada', id });
          }
        }
      );
    });
  });
});

app.put('/api/habitaciones/:id/estado', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { estado } = req.body;
  const estadosPermitidosListado = ['Disponible', 'En limpieza'];
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  if (!estado || !estadosPermitidosListado.includes(estado)) {
    return res.status(400).json({
      error:
        'Desde el listado solo puede elegir Disponible o En limpieza. Ocupada y Reservada las define una reserva; Fuera de servicio se cambia en Modificar.'
    });
  }
  db.habitacionTieneReservaActivaHoy(id, (errRes, conReserva) => {
    if (errRes) {
      return res.status(500).json({ error: errRes.message });
    }
    if (conReserva) {
      return res.status(403).json({
        error: 'La habitación está ocupada por una reserva activa. Finalice o modifique la reserva para cambiar el estado.'
      });
    }
    db.getHabitacionById(id, (errHab, hab) => {
      if (errHab) {
        return res.status(500).json({ error: errHab.message });
      }
      if (!hab) {
        return res.status(404).json({ error: 'Habitación no encontrada' });
      }
      const estActual = String(hab.estado || '');
      if (estActual === 'Fuera de servicio') {
        return res.status(403).json({
          error: 'La habitación está fuera de servicio. Use Modificar para rehabilitarla.'
        });
      }
      if (estActual === 'Ocupada' || estActual === 'Reservada') {
        return res.status(403).json({
          error: `No puede cambiar el estado "${estActual}" desde el listado. Use Modificar o gestione la reserva.`
        });
      }
      db.updateHabitacionEstado(id, estado, (err) => {
        if (err) {
          res.status(500).json({ error: err.message });
        } else {
          res.json({ message: 'Estado actualizado' });
        }
      });
    });
  });
});

app.delete('/api/habitaciones/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  db.deleteHabitacion(id, (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ message: 'Habitación eliminada' });
    }
  });
});

// ========== RUTAS DE CAMAS ==========
app.get('/api/habitaciones/:id/camas', requireAuth, (req, res) => {
  const { id } = req.params;
  db.getCamasByHabitacion(id, (err, camas) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(camas);
    }
  });
});

app.post('/api/habitaciones/:id/camas', requireAuth, (req, res) => {
  const { id } = req.params;
  const { tipo, numero } = req.body;
  if (!tipo) {
    return res.status(400).json({ error: 'El tipo de cama es requerido' });
  }
  db.createCama(id, tipo, numero || null, (err, cama) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.status(201).json(cama);
    }
  });
});

app.delete('/api/camas/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  db.deleteCama(id, (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ message: 'Cama eliminada' });
    }
  });
});

// ========== RUTAS DE HUÉSPEDES ==========
app.get('/api/huespedes', requireAuth, (req, res) => {
  db.getAllHuespedes((err, huespedes) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(huespedes);
    }
  });
});

app.post('/api/huespedes', requireAuth, (req, res) => {
  const { nombre, apellido, email, telefono, tipo_documento, documento } = req.body;
  if (!nombre) {
    return res.status(400).json({ error: 'El nombre es requerido' });
  }
  db.createHuesped(
    nombre,
    apellido || '',
    email || '',
    telefono || '',
    tipo_documento || 'Cédula',
    documento || '',
    (err, huesped) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.status(201).json(huesped);
    }
    }
  );
});

app.put('/api/huespedes/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Cuerpo de la petición inválido' });
  }
  const { nombre, apellido, email, telefono, tipo_documento, documento } = req.body;
  if (!nombre || !String(nombre).trim()) {
    return res.status(400).json({ error: 'El nombre es requerido' });
  }
  db.getHuespedById(id, (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Huésped no encontrado' });
    }
    db.updateHuesped(
      id,
      nombre.trim(),
      apellido != null ? String(apellido).trim() : '',
      email != null ? String(email).trim() : '',
      telefono != null ? String(telefono).trim() : '',
      tipo_documento != null ? String(tipo_documento).trim() : 'Cédula',
      documento != null ? String(documento).trim() : '',
      (err2) => {
        if (err2) {
          return res.status(500).json({ error: err2.message });
        }
        res.json({ message: 'Huésped actualizado', id });
      }
    );
  });
});

app.delete('/api/huespedes/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  db.deleteHuesped(id, (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ message: 'Huésped eliminado' });
    }
  });
});

// ========== COMPROBANTES / FACTURAS ==========
function totalFacturaReserva(row, tipo) {
  return tipo === 'chinchorro'
    ? db.calcularTotalReservaChinchorroRow(row)
    : db.calcularTotalReservaHabitacionRow(row);
}

app.get('/api/comprobantes/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) {
    return res.status(400).json({ error: 'Comprobante no válido' });
  }
  db.getComprobanteById(id, (err, comprobante) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!comprobante) {
      return res.status(404).json({ error: 'Comprobante no encontrado' });
    }
    res.json(comprobante);
  });
});

app.get('/api/comprobantes/:id/qr.png', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) {
    return res.status(400).send('Comprobante no válido');
  }
  db.getComprobanteById(id, (err, comprobante) => {
    if (err || !comprobante) {
      return res.status(404).send('No encontrado');
    }
    if (comprobante.qr_imagen && comprobante.qr_imagen.startsWith('data:image')) {
      const base64 = comprobante.qr_imagen.replace(/^data:image\/\w+;base64,/, '');
      res.setHeader('Content-Type', 'image/png');
      return res.send(Buffer.from(base64, 'base64'));
    }
    const url = comprobante.qr_url || (comprobante.cufe ? dian.urlValidacionDian(comprobante.cufe) : null);
    if (!url) {
      return res.status(404).send('Sin QR');
    }
    QRCode.toBuffer(url, { width: 180, margin: 1 })
      .then((buf) => {
        res.setHeader('Content-Type', 'image/png');
        res.send(buf);
      })
      .catch(() => res.status(500).send('Error al generar QR'));
  });
});

app.post('/api/comprobantes/reserva/dian', requireAuth, (req, res) => {
  const { tipo, reserva_id } = req.body || {};
  const tipoNorm = String(tipo || '').trim().toLowerCase();
  if (!['habitacion', 'chinchorro'].includes(tipoNorm)) {
    return res.status(400).json({ error: 'Tipo de comprobante no válido' });
  }
  const reservaId = parseInt(reserva_id, 10);
  if (!reservaId) {
    return res.status(400).json({ error: 'Reserva no válida' });
  }

  db.getReservaFacturaContext(tipoNorm, reservaId, (errCtx, reserva) => {
    if (errCtx) {
      return res.status(500).json({ error: errCtx.message });
    }
    if (!reserva) {
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }

    db.getHotel((errHotel, hotel) => {
      if (errHotel) {
        return res.status(500).json({ error: errHotel.message });
      }
      const h = hotel || {};
      if (!db.hotelTieneResolucionDianCompleta(h)) {
        return res.status(400).json({
          error:
            'Configure en Configuración → Facturación electrónica DIAN: NIT, número de resolución, prefijo, rango (desde/hasta) y clave técnica.'
        });
      }

      const nitEmisor = String(h.nit || '').trim();

      db.registrarComprobanteFactura(tipoNorm, reservaId, async (errComp, comprobante) => {
        if (errComp) {
          return res.status(500).json({ error: errComp.message || 'No se pudo crear el comprobante' });
        }

        const rangoVal = db.validarConsecutivoEnRangoDian(h, comprobante.consecutivo);
        if (!rangoVal.ok) {
          return res.status(400).json({ error: rangoVal.error });
        }

        const valorTotal = totalFacturaReserva(reserva, tipoNorm);
        const nombreAdq = `${reserva.huesped_nombre || ''} ${reserva.huesped_apellido || ''}`.trim();
        const numeroDian = db.formatoNumeroFacturaDian(h, comprobante.consecutivo);
        const datosDian = {
          numeroFactura: comprobante.consecutivo,
          numeroDian,
          consecutivo: comprobante.consecutivo,
          tipo: tipoNorm,
          reservaId,
          fechaEmision: comprobante.fecha_emision,
          valorTotal,
          valorBase: valorTotal,
          valorIva: 0,
          nitEmisor,
          razonSocial: h.razon_social || h.nombre || 'Establecimiento',
          documentoAdquiriente: reserva.huesped_documento || '222222222222',
          nombreAdquiriente: nombreAdq || 'Consumidor final',
          claveTecnica: h.dian_clave_tecnica,
          resolucion: {
            numero: h.dian_resolucion,
            fecha: h.dian_resolucion_fecha,
            prefijo: h.dian_prefijo,
            rango_desde: h.dian_rango_desde,
            rango_hasta: h.dian_rango_hasta,
            vigencia_desde: h.dian_vigencia_desde,
            vigencia_hasta: h.dian_vigencia_hasta
          }
        };

        try {
          const respDian = await dian.enviarFacturaDIAN(datosDian);
          let qrImagen = null;
          try {
            qrImagen = await QRCode.toDataURL(respDian.qr_url, { width: 180, margin: 1 });
          } catch (qrErr) {
            console.warn('QR factura:', qrErr.message);
          }

          db.updateComprobanteDian(
            comprobante.id,
            {
              dian_estado: respDian.estado === 'rechazado' ? 'rechazado' : 'aceptado',
              cufe: respDian.cufe,
              qr_url: respDian.qr_url,
              qr_imagen: qrImagen,
              dian_respuesta: respDian.respuesta,
              valor_total: valorTotal
            },
            (errUpd, actualizado) => {
              if (errUpd) {
                return res.status(500).json({ error: errUpd.message });
              }
              res.json({
                comprobante: {
                  ...actualizado,
                  numero_dian: numeroDian
                },
                resolucion: datosDian.resolucion,
                dian: {
                  estado: respDian.estado,
                  modo: respDian.modo,
                  mensaje: respDian.respuesta
                }
              });
            }
          );
        } catch (dianErr) {
          db.updateComprobanteDian(
            comprobante.id,
            {
              dian_estado: 'rechazado',
              dian_respuesta: dianErr.message || 'Error al enviar a DIAN',
              valor_total: valorTotal
            },
            () => {
              res.status(502).json({
                error: dianErr.message || 'DIAN rechazó o no respondió el documento',
                comprobante_id: comprobante.id
              });
            }
          );
        }
      });
    });
  });
});

app.put('/api/hotel/facturacion', requireAuth, requireAdmin, (req, res) => {
  const body = req.body || {};
  const desde = parseInt(body.dian_rango_desde, 10);
  const hasta = parseInt(body.dian_rango_hasta, 10);
  if (!String(body.nit || '').trim()) {
    return res.status(400).json({ error: 'El NIT es obligatorio.' });
  }
  if (!String(body.dian_resolucion || '').trim()) {
    return res.status(400).json({ error: 'El número de resolución DIAN es obligatorio.' });
  }
  if (!String(body.dian_prefijo || '').trim()) {
    return res.status(400).json({ error: 'El prefijo de facturación es obligatorio.' });
  }
  if (!String(body.dian_clave_tecnica || '').trim()) {
    return res.status(400).json({ error: 'La clave técnica DIAN es obligatoria.' });
  }
  if (!Number.isFinite(desde) || !Number.isFinite(hasta) || desde < 1 || hasta < desde) {
    return res.status(400).json({ error: 'El rango autorizado (desde / hasta) no es válido.' });
  }
  db.updateHotelFacturacion(body, (err) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({
      message: 'Resolución y datos de facturación DIAN guardados',
      resolucion_completa: true
    });
  });
});

app.post('/api/comprobantes/reserva', requireAuth, (req, res) => {
  const { tipo, reserva_id } = req.body || {};
  const tipoNorm = String(tipo || '').trim().toLowerCase();
  if (!['habitacion', 'chinchorro'].includes(tipoNorm)) {
    return res.status(400).json({ error: 'Tipo de comprobante no válido' });
  }
  const reservaId = parseInt(reserva_id, 10);
  if (!reservaId) {
    return res.status(400).json({ error: 'Reserva no válida' });
  }
  db.registrarComprobanteFactura(tipoNorm, reservaId, (err, comprobante) => {
    if (err) {
      return res.status(500).json({ error: err.message || 'No se pudo generar el consecutivo' });
    }
    res.json({
      consecutivo: comprobante.consecutivo,
      numero: comprobante.numero,
      tipo: comprobante.tipo,
      reserva_id: comprobante.reserva_id,
      fecha_emision: comprobante.fecha_emision
    });
  });
});

// ========== RUTAS DE RESERVAS ==========
app.get('/api/reservas', requireAuth, (req, res) => {
  db.getAllReservas((err, reservas) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(reservas);
    }
  });
});

app.post('/api/reservas', requireAuth, (req, res) => {
  const { habitacion_id, huesped_id, adultos, ninos, tipo_habitacion_requerida, metodo_pago, observaciones, fecha_ingreso, fecha_salida } = req.body;
  if (!habitacion_id || !huesped_id || !fecha_ingreso || !fecha_salida) {
    return res.status(400).json({ error: 'Todos los campos son requeridos' });
  }
  const adultosNum = Math.max(1, parseInt(adultos, 10) || 1);
  const ninosNum = Math.max(0, parseInt(ninos, 10) || 0);
  const metodosPagoValidos = ['Efectivo', 'Tarjeta', 'Transferencia'];
  const metodoPagoSeguro = metodosPagoValidos.includes(String(metodo_pago)) ? String(metodo_pago) : 'Efectivo';
  const tarifaNoche = parseTarifaNoche(req.body);
  if (new Date(fecha_ingreso) >= new Date(fecha_salida)) {
    return res.status(400).json({ error: 'La fecha de salida debe ser posterior a la de ingreso' });
  }
  db.createReserva(
    habitacion_id,
    huesped_id,
    adultosNum,
    ninosNum,
    tipo_habitacion_requerida != null ? String(tipo_habitacion_requerida).trim() : '',
    metodoPagoSeguro,
    observaciones != null ? String(observaciones).trim() : '',
    fecha_ingreso,
    fecha_salida,
    tarifaNoche,
    parseMontoAbonado(req.body),
    (err, reserva) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.status(201).json(reserva);
    }
    }
  );
});

app.post('/api/reservas/:id/abono', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  const monto = parseMontoAbonado(req.body);
  if (monto <= 0) {
    return res.status(400).json({ error: 'Indique un monto de abono mayor a cero' });
  }
  db.registrarAbonoReserva(id, monto, (err, result) => {
    if (err) {
      const msg = String(err.message || '');
      if (msg.includes('no encontrada')) return res.status(404).json({ error: err.message });
      if (msg.includes('cancelada') || msg.includes('totalizada') || msg.includes('calculable')) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(500).json({ error: err.message });
    }
    res.json({ message: 'Abono registrado', ...result });
  });
});

app.post('/api/reservas/:id/totalizar', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  db.totalizarReserva(id, (err, result) => {
    if (err) {
      const msg = String(err.message || '');
      if (msg.includes('no encontrada')) return res.status(404).json({ error: err.message });
      if (msg.includes('cancelada') || msg.includes('calculable')) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(500).json({ error: err.message });
    }
    res.json({ message: 'Reserva totalizada', ...result });
  });
});

app.put('/api/reservas/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { habitacion_id, huesped_id, adultos, ninos, tipo_habitacion_requerida, metodo_pago, observaciones, fecha_ingreso, fecha_salida } = req.body;
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  const hid = parseInt(habitacion_id, 10);
  const gid = parseInt(huesped_id, 10);
  const adultosNum = Math.max(1, parseInt(adultos, 10) || 1);
  const ninosNum = Math.max(0, parseInt(ninos, 10) || 0);
  const metodosPagoValidos = ['Efectivo', 'Tarjeta', 'Transferencia'];
  const metodoPagoSeguro = metodosPagoValidos.includes(String(metodo_pago)) ? String(metodo_pago) : 'Efectivo';
  if (!Number.isFinite(hid) || hid < 1 || !Number.isFinite(gid) || gid < 1 || !fecha_ingreso || !fecha_salida) {
    return res.status(400).json({ error: 'Todos los campos son requeridos' });
  }
  if (new Date(fecha_ingreso) >= new Date(fecha_salida)) {
    return res.status(400).json({ error: 'La fecha de salida debe ser posterior a la de ingreso' });
  }
  db.updateReservaDatos(
    id,
    hid,
    gid,
    adultosNum,
    ninosNum,
    tipo_habitacion_requerida != null ? String(tipo_habitacion_requerida).trim() : '',
    metodoPagoSeguro,
    observaciones != null ? String(observaciones).trim() : '',
    fecha_ingreso,
    fecha_salida,
    parseTarifaNoche(req.body),
    (err) => {
    if (err) {
      if (String(err.message).includes('no encontrada')) {
        return res.status(404).json({ error: err.message });
      }
      if (String(err.message).includes('ya está reservada')) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(500).json({ error: err.message });
    }
    res.json({ message: 'Reserva actualizada', id });
    }
  );
});

app.put('/api/reservas/:id/estado', requireAuth, (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;
  if (!estado || !['Activa', 'Cancelada', 'Finalizada'].includes(estado)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }
  db.updateReservaEstado(id, estado, (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ message: 'Estado de reserva actualizado' });
    }
  });
});

app.delete('/api/reservas/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  db.deleteReserva(id, (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ message: 'Reserva eliminada' });
    }
  });
});

// ========== RUTAS DE CHINCHORROS ==========
app.get('/api/chinchorros', requireAuth, (req, res) => {
  db.getAllChinchorros((err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

app.post('/api/chinchorros', requireAuth, (req, res) => {
  const { nombre, tipo, piso, estado } = req.body;
  const estadosValidos = ['Disponible', 'Ocupada', 'Reservada', 'En limpieza', 'Fuera de servicio'];
  const estadoSeguro = estadosValidos.includes(String(estado)) ? String(estado) : 'Disponible';
  generarIdentificadoresChinchorro(nombre, (errId, codigo, numero, nombreSeguro) => {
    if (errId) {
      return res.status(400).json({ error: errId.message });
    }
    db.createChinchorro(
      codigo,
      numero,
      nombreSeguro,
      tipo || 'Sencilla',
      piso ? String(piso).trim() : '',
      estadoSeguro,
      0,
      (err, row) => {
        if (err) {
          res.status(500).json({ error: err.message });
        } else {
          res.status(201).json(row);
        }
      }
    );
  });
});

app.put('/api/chinchorros/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { nombre, tipo, piso, estado } = req.body;
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  const nombreSeguro = nombre != null ? String(nombre).trim() : '';
  if (!nombreSeguro) {
    return res.status(400).json({ error: 'El nombre del chinchorro es requerido' });
  }
  const estadosValidos = ['Disponible', 'Ocupada', 'Reservada', 'En limpieza', 'Fuera de servicio'];
  const estadoSeguro = estadosValidos.includes(String(estado)) ? String(estado) : 'Disponible';
  db.chinchorroTieneReservaActivaHoy(id, (errRes, conReserva) => {
    if (errRes) {
      return res.status(500).json({ error: errRes.message });
    }
    db.getChinchorroById(id, (errCh, ch) => {
      if (errCh) {
        return res.status(500).json({ error: errCh.message });
      }
      if (!ch) {
        return res.status(404).json({ error: 'Chinchorro no encontrado' });
      }
      const estadoFinal = resolverEstadoInventarioModificar(ch, estadoSeguro, conReserva);
      const codigo = (ch.codigo && String(ch.codigo).trim()) || `CH-${id}`;
      const numero = numeroChinchorroInventario(ch, id, nombreSeguro);
      const precio = ch.precio_diario != null ? Number(ch.precio_diario) : 0;
      db.updateChinchorroDatos(
        id,
        codigo,
        numero,
        nombreSeguro,
        tipo || 'Sencilla',
        piso ? String(piso).trim() : '',
        estadoFinal,
        precio,
        (err) => {
          if (err) {
            res.status(500).json({ error: err.message });
          } else {
            res.json({ message: 'Chinchorro actualizado', id });
          }
        }
      );
    });
  });
});

app.put('/api/chinchorros/:id/estado', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { estado } = req.body;
  const estadosPermitidosListado = ['Disponible', 'En limpieza'];
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  if (!estado || !estadosPermitidosListado.includes(estado)) {
    return res.status(400).json({
      error:
        'Desde el listado solo puede elegir Disponible o En limpieza. Ocupada y Reservada las define una reserva; Fuera de servicio se cambia en Modificar.'
    });
  }
  db.chinchorroTieneReservaActivaHoy(id, (errRes, conReserva) => {
    if (errRes) {
      return res.status(500).json({ error: errRes.message });
    }
    if (conReserva) {
      return res.status(403).json({
        error: 'El chinchorro está ocupado por una reserva activa. Finalice o modifique la reserva.'
      });
    }
    db.getChinchorroById(id, (errCh, ch) => {
      if (errCh) {
        return res.status(500).json({ error: errCh.message });
      }
      if (!ch) {
        return res.status(404).json({ error: 'Chinchorro no encontrado' });
      }
      const estActual = String(ch.estado || '');
      if (estActual === 'Fuera de servicio') {
        return res.status(403).json({
          error: 'El chinchorro está fuera de servicio. Use Modificar para rehabilitarlo.'
        });
      }
      if (estActual === 'Ocupada' || estActual === 'Reservada') {
        return res.status(403).json({
          error: `No puede cambiar el estado "${estActual}" desde el listado. Use Modificar o gestione la reserva.`
        });
      }
      db.updateChinchorroEstado(id, estado, (err) => {
        if (err) {
          res.status(500).json({ error: err.message });
        } else {
          res.json({ message: 'Estado actualizado' });
        }
      });
    });
  });
});

app.delete('/api/chinchorros/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  db.deleteChinchorro(id, (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ message: 'Chinchorro eliminado' });
    }
  });
});

// ========== RUTAS DE RESERVAS DE CHINCHORROS ==========
app.get('/api/reservas-chinchorros', requireAuth, (req, res) => {
  db.getAllReservasChinchorros((err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

app.post('/api/reservas-chinchorros', requireAuth, (req, res) => {
  const { chinchorro_id, huesped_id, adultos, ninos, tipo_requerido, metodo_pago, observaciones, fecha_ingreso, fecha_salida } = req.body;
  if (!chinchorro_id || !huesped_id || !fecha_ingreso || !fecha_salida) {
    return res.status(400).json({ error: 'Todos los campos son requeridos' });
  }
  const adultosNum = Math.max(1, parseInt(adultos, 10) || 1);
  const ninosNum = Math.max(0, parseInt(ninos, 10) || 0);
  const metodosPagoValidos = ['Efectivo', 'Tarjeta', 'Transferencia'];
  const metodoPagoSeguro = metodosPagoValidos.includes(String(metodo_pago)) ? String(metodo_pago) : 'Efectivo';
  if (new Date(fecha_ingreso) >= new Date(fecha_salida)) {
    return res.status(400).json({ error: 'La fecha de fin debe ser posterior al inicio' });
  }
  db.createReservaChinchorro(
    chinchorro_id,
    huesped_id,
    adultosNum,
    ninosNum,
    tipo_requerido != null ? String(tipo_requerido).trim() : '',
    metodoPagoSeguro,
    observaciones != null ? String(observaciones).trim() : '',
    fecha_ingreso,
    fecha_salida,
    parseTarifaDia(req.body),
    parseMontoAbonado(req.body),
    (err, reserva) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.status(201).json(reserva);
    }
    }
  );
});

app.post('/api/reservas-chinchorros/:id/abono', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  const monto = parseMontoAbonado(req.body);
  if (monto <= 0) {
    return res.status(400).json({ error: 'Indique un monto de abono mayor a cero' });
  }
  db.registrarAbonoReservaChinchorro(id, monto, (err, result) => {
    if (err) {
      const msg = String(err.message || '');
      if (msg.includes('no encontrada')) return res.status(404).json({ error: err.message });
      if (msg.includes('cancelada') || msg.includes('totalizada') || msg.includes('calculable')) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(500).json({ error: err.message });
    }
    res.json({ message: 'Abono registrado', ...result });
  });
});

app.post('/api/reservas-chinchorros/:id/totalizar', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  db.totalizarReservaChinchorro(id, (err, result) => {
    if (err) {
      const msg = String(err.message || '');
      if (msg.includes('no encontrada')) return res.status(404).json({ error: err.message });
      if (msg.includes('cancelada') || msg.includes('calculable')) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(500).json({ error: err.message });
    }
    res.json({ message: 'Reserva totalizada', ...result });
  });
});

app.put('/api/reservas-chinchorros/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { chinchorro_id, huesped_id, adultos, ninos, tipo_requerido, metodo_pago, observaciones, fecha_ingreso, fecha_salida } = req.body;
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  const cid = parseInt(chinchorro_id, 10);
  const hid = parseInt(huesped_id, 10);
  const adultosNum = Math.max(1, parseInt(adultos, 10) || 1);
  const ninosNum = Math.max(0, parseInt(ninos, 10) || 0);
  const metodosPagoValidos = ['Efectivo', 'Tarjeta', 'Transferencia'];
  const metodoPagoSeguro = metodosPagoValidos.includes(String(metodo_pago)) ? String(metodo_pago) : 'Efectivo';
  if (!Number.isFinite(cid) || cid < 1 || !Number.isFinite(hid) || hid < 1 || !fecha_ingreso || !fecha_salida) {
    return res.status(400).json({ error: 'Todos los campos son requeridos' });
  }
  if (new Date(fecha_ingreso) >= new Date(fecha_salida)) {
    return res.status(400).json({ error: 'La fecha de fin debe ser posterior al inicio' });
  }
  db.updateReservaChinchorroDatos(
    id,
    cid,
    hid,
    adultosNum,
    ninosNum,
    tipo_requerido != null ? String(tipo_requerido).trim() : '',
    metodoPagoSeguro,
    observaciones != null ? String(observaciones).trim() : '',
    fecha_ingreso,
    fecha_salida,
    parseTarifaDia(req.body),
    (err) => {
    if (err) {
      if (String(err.message).includes('no encontrada')) {
        return res.status(404).json({ error: err.message });
      }
      if (String(err.message).includes('reservado')) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(500).json({ error: err.message });
    }
    res.json({ message: 'Reserva de chinchorro actualizada', id });
    }
  );
});

app.put('/api/reservas-chinchorros/:id/estado', requireAuth, (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;
  if (!estado || !['Activa', 'Cancelada', 'Finalizada'].includes(estado)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }
  db.updateReservaChinchorroEstado(id, estado, (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ message: 'Estado de reserva actualizado' });
    }
  });
});

app.delete('/api/reservas-chinchorros/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  db.deleteReservaChinchorro(id, (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ message: 'Reserva de chinchorro eliminada' });
    }
  });
});

// Entrada principal: login o app según sesión
app.get('/', (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect('/index.html');
  }
  return res.redirect('/login.html');
});

// Imágenes subidas fuera de /public (producción con DATA_DIR=/data)
if (DATA_DIR) {
  const uploadsRoot = path.join(DATA_DIR, 'uploads');
  if (!fs.existsSync(uploadsRoot)) {
    fs.mkdirSync(uploadsRoot, { recursive: true });
  }
  app.use('/uploads', express.static(uploadsRoot));
}

// Servir estáticos después de rutas API (ruta absoluta para producción en Render).
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

// Cualquier ruta GET no encontrada → login (evita pantalla en blanco "Not Found").
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }
  if (req.session && req.session.userId) {
    return res.redirect('/index.html');
  }
  return res.redirect('/login.html');
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
  const dbInfo = db.getDatabaseInfo();
  console.log(`Base de datos: ${dbInfo.path}`);
  if (process.env.DATA_DIR) {
    console.log(`Datos persistentes (disco Render): ${process.env.DATA_DIR}`);
  }
  console.log('API: GET /api/status | GET /api/hotel/nombre | PUT /api/hotel/tema');
});
