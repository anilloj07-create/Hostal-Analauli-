const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

const FONDO_UPLOAD_DIR = path.join(__dirname, 'public', 'uploads', 'fondos');
if (!fs.existsSync(FONDO_UPLOAD_DIR)) {
  fs.mkdirSync(FONDO_UPLOAD_DIR, { recursive: true });
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

// Middleware
app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true
}));
app.use(cookieParser());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Configuración de sesiones
app.use(session({
  secret: 'hotel-reservas-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // En producción con HTTPS debería ser true
    httpOnly: true,
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
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
  }
  
  db.getUserByUsername(String(username).trim(), (err, user) => {
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
    
    db.verifyPassword(password, user.password, (err, isValid) => {
      if (err) {
        return res.status(500).json({ error: 'Error en el servidor' });
      }
      
      if (!isValid) {
        return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
      }

      const rol = db.normalizarRolUsuario(user.rol, user.username);

      // Crear sesión
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.nombre = user.nombre;
      req.session.rol = rol;

      // Actualizar último acceso
      db.updateLastAccess(user.id, () => {});

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
    db.verifyPassword(password_actual, user.password, (err, ok) => {
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

/** Comprueba que el servidor expone las rutas actuales (útil tras actualizar el código). */
app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    version: 2,
    features: ['hotel-tema-put', 'reservas-put']
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
        fondo_imagen_url: null
      });
    }
    res.json({
      nombre: row.nombre || 'Mi Hotel',
      color_primario: row.color_primario || null,
      color_secundario: row.color_secundario || null,
      color_acento: row.color_acento || null,
      color_titulo: row.color_titulo || null,
      fondo_imagen_url: row.fondo_imagen_url || null
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
      return res.json({
        message: 'Colores restaurados a los predeterminados',
        reiniciar: true
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

    db.updateHotelApariencia(next[0], next[1], next[2], next[3], fondoImagenUrl, (err2) => {
      if (err2) {
        return res.status(500).json({ error: err2.message });
      }
      res.json({
        message: 'Colores actualizados',
        color_primario: next[0],
        color_secundario: next[1],
        color_acento: next[2],
        color_titulo: next[3],
        fondo_imagen_url: fondoImagenUrl
      });
    });
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
  const { numero, tipo } = req.body;
  if (!numero) {
    return res.status(400).json({ error: 'El número de habitación es requerido' });
  }
  db.createHabitacion(numero, tipo || 'Estándar', parsePrecioDiario(req.body), (err, habitacion) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.status(201).json(habitacion);
    }
  });
});

app.put('/api/habitaciones/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { numero, tipo } = req.body;
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  if (!numero || !String(numero).trim()) {
    return res.status(400).json({ error: 'El número de habitación es requerido' });
  }
  db.updateHabitacionDatos(id, String(numero).trim(), tipo || 'Estándar', parsePrecioDiario(req.body), (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ message: 'Habitación actualizada', id });
    }
  });
});

app.put('/api/habitaciones/:id/estado', requireAuth, (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;
  if (!estado || !['Disponible', 'Ocupada'].includes(estado)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }
  db.updateHabitacionEstado(id, estado, (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ message: 'Estado actualizado' });
    }
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
  const { nombre, apellido, email, telefono, documento } = req.body;
  if (!nombre) {
    return res.status(400).json({ error: 'El nombre es requerido' });
  }
  db.createHuesped(nombre, apellido || '', email || '', telefono || '', documento || '', (err, huesped) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.status(201).json(huesped);
    }
  });
});

app.put('/api/huespedes/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Cuerpo de la petición inválido' });
  }
  const { nombre, apellido, email, telefono, documento } = req.body;
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
  const { habitacion_id, huesped_id, fecha_ingreso, fecha_salida } = req.body;
  if (!habitacion_id || !huesped_id || !fecha_ingreso || !fecha_salida) {
    return res.status(400).json({ error: 'Todos los campos son requeridos' });
  }
  if (new Date(fecha_ingreso) >= new Date(fecha_salida)) {
    return res.status(400).json({ error: 'La fecha de salida debe ser posterior a la de ingreso' });
  }
  db.createReserva(habitacion_id, huesped_id, fecha_ingreso, fecha_salida, (err, reserva) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.status(201).json(reserva);
    }
  });
});

app.put('/api/reservas/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { habitacion_id, huesped_id, fecha_ingreso, fecha_salida } = req.body;
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  const hid = parseInt(habitacion_id, 10);
  const gid = parseInt(huesped_id, 10);
  if (!Number.isFinite(hid) || hid < 1 || !Number.isFinite(gid) || gid < 1 || !fecha_ingreso || !fecha_salida) {
    return res.status(400).json({ error: 'Todos los campos son requeridos' });
  }
  if (new Date(fecha_ingreso) >= new Date(fecha_salida)) {
    return res.status(400).json({ error: 'La fecha de salida debe ser posterior a la de ingreso' });
  }
  db.updateReservaDatos(id, hid, gid, fecha_ingreso, fecha_salida, (err) => {
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
  });
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
  const { codigo, zona } = req.body;
  if (!codigo || !String(codigo).trim()) {
    return res.status(400).json({ error: 'El código del chinchorro es requerido' });
  }
  db.createChinchorro(String(codigo).trim(), zona ? String(zona).trim() : '', parsePrecioDiario(req.body), (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.status(201).json(row);
    }
  });
});

app.put('/api/chinchorros/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { codigo, zona } = req.body;
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  if (!codigo || !String(codigo).trim()) {
    return res.status(400).json({ error: 'El código del chinchorro es requerido' });
  }
  db.updateChinchorroDatos(
    id,
    String(codigo).trim(),
    zona ? String(zona).trim() : '',
    parsePrecioDiario(req.body),
    (err) => {
      if (err) {
        res.status(500).json({ error: err.message });
      } else {
        res.json({ message: 'Chinchorro actualizado', id });
      }
    }
  );
});

app.put('/api/chinchorros/:id/estado', requireAuth, (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;
  if (!estado || !['Disponible', 'Ocupada'].includes(estado)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }
  db.updateChinchorroEstado(id, estado, (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ message: 'Estado actualizado' });
    }
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
  const { chinchorro_id, huesped_id, fecha_ingreso, fecha_salida } = req.body;
  if (!chinchorro_id || !huesped_id || !fecha_ingreso || !fecha_salida) {
    return res.status(400).json({ error: 'Todos los campos son requeridos' });
  }
  if (new Date(fecha_ingreso) >= new Date(fecha_salida)) {
    return res.status(400).json({ error: 'La fecha de fin debe ser posterior al inicio' });
  }
  db.createReservaChinchorro(chinchorro_id, huesped_id, fecha_ingreso, fecha_salida, (err, reserva) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.status(201).json(reserva);
    }
  });
});

app.put('/api/reservas-chinchorros/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { chinchorro_id, huesped_id, fecha_ingreso, fecha_salida } = req.body;
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  const cid = parseInt(chinchorro_id, 10);
  const hid = parseInt(huesped_id, 10);
  if (!Number.isFinite(cid) || cid < 1 || !Number.isFinite(hid) || hid < 1 || !fecha_ingreso || !fecha_salida) {
    return res.status(400).json({ error: 'Todos los campos son requeridos' });
  }
  if (new Date(fecha_ingreso) >= new Date(fecha_salida)) {
    return res.status(400).json({ error: 'La fecha de fin debe ser posterior al inicio' });
  }
  db.updateReservaChinchorroDatos(id, cid, hid, fecha_ingreso, fecha_salida, (err) => {
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
  });
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

// Servir estáticos después de rutas API (evita que archivos públicos interfieran con /api).
app.use(express.static('public'));

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
  console.log('API: GET /api/hotel/nombre | GET /api/hotel/apariencia | PUT /api/hotel/tema');
});
