const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

/** Carpeta de datos: en Render con disco use DATA_DIR=/data; si no, ./data en el proyecto. */
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');

const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(DATA_DIR, 'hotel.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** Copia la BD incluida en el repo (seed) si aún no hay archivo local. */
const SEED_DB = path.join(__dirname, 'seed', 'hotel.db');
const applySeed =
  process.env.APPLY_DB_SEED === '1' ||
  process.env.APPLY_DB_SEED === 'true';
if (fs.existsSync(SEED_DB) && (applySeed || !fs.existsSync(DB_PATH))) {
  try {
    fs.copyFileSync(SEED_DB, DB_PATH);
    console.log(applySeed ? 'BD actualizada desde seed:' : 'BD cargada desde seed:', SEED_DB);
  } catch (e) {
    console.warn('No se pudo copiar seed/hotel.db:', e.message);
  }
}

/** Si existe hotel.db antiguo en la raíz, copiarlo a data/ (migración local). */
const legacyDb = path.join(__dirname, 'hotel.db');
if (!fs.existsSync(DB_PATH) && fs.existsSync(legacyDb)) {
  try {
    fs.copyFileSync(legacyDb, DB_PATH);
    console.log('Base de datos migrada a:', DB_PATH);
  } catch (e) {
    console.warn('No se pudo migrar hotel.db a data/:', e.message);
  }
}

let dbReady = false;

// Crear conexión a la base de datos
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error al conectar con la base de datos:', err.message);
    console.error('Ruta intentada:', DB_PATH);
  } else {
    dbReady = true;
    console.log('Conectado a la base de datos SQLite');
    console.log('Archivo BD:', DB_PATH);
    db.run('PRAGMA journal_mode = WAL', (walErr) => {
      if (walErr) console.warn('PRAGMA WAL:', walErr.message);
      initDatabase();
    });
  }
});

function getDatabaseInfo() {
  return {
    connected: dbReady,
    path: DB_PATH,
    dataDir: DATA_DIR,
    exists: fs.existsSync(DB_PATH)
  };
}

function pingDatabase(callback) {
  if (!dbReady) {
    return callback(new Error('Base de datos no conectada'));
  }
  db.get('SELECT 1 as ok', (err, row) => {
    if (err) return callback(err);
    callback(null, !!(row && row.ok === 1));
  });
}

// Inicializar tablas
function initDatabase() {
  db.serialize(() => {
    // Tabla de configuración del hotel
    db.run(`CREATE TABLE IF NOT EXISTS hotel (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL DEFAULT 'Mi Hotel',
      fecha_actualizacion DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
      if (err) {
        console.error('Error al crear tabla hotel:', err);
      } else {
        // Insertar nombre por defecto si no existe
        db.get("SELECT COUNT(*) as count FROM hotel", (err, row) => {
          if (!err && row.count === 0) {
            db.run("INSERT INTO hotel (nombre) VALUES ('Mi Hotel')");
          }
        });
      }
    });

    const hotelThemeMigrations = [
      'ALTER TABLE hotel ADD COLUMN color_primario TEXT',
      'ALTER TABLE hotel ADD COLUMN color_secundario TEXT',
      'ALTER TABLE hotel ADD COLUMN color_acento TEXT',
      'ALTER TABLE hotel ADD COLUMN color_titulo TEXT',
      'ALTER TABLE hotel ADD COLUMN fondo_imagen_url TEXT',
      'ALTER TABLE hotel ADD COLUMN logo_url TEXT'
    ];
    hotelThemeMigrations.forEach((sql) => {
      db.run(sql, (e) => {
        if (e && !String(e.message).toLowerCase().includes('duplicate column')) {
          console.error('Migración tema hotel:', e.message);
        }
      });
    });

    const hotelVistaMigrations = [
      "ALTER TABLE hotel ADD COLUMN vista_habitaciones TEXT DEFAULT 'tarjetas'",
      "ALTER TABLE hotel ADD COLUMN vista_chinchorros TEXT DEFAULT 'tarjetas'"
    ];
    hotelVistaMigrations.forEach((sql) => {
      db.run(sql, (e) => {
        if (e && !String(e.message).toLowerCase().includes('duplicate column')) {
          console.error('Migración vistas inventario:', e.message);
        }
      });
    });

    // Tabla de habitaciones
    db.run(`CREATE TABLE IF NOT EXISTS habitaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT UNIQUE,
      numero TEXT NOT NULL UNIQUE,
      nombre TEXT,
      tipo TEXT,
      piso TEXT,
      estado TEXT NOT NULL DEFAULT 'Disponible',
      fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
      if (err) {
        console.error('Error al crear tabla habitaciones:', err);
      } else {
        db.run('ALTER TABLE habitaciones ADD COLUMN codigo TEXT', (e) => {
          if (e && !String(e.message).toLowerCase().includes('duplicate column')) {
            console.error('Migración código habitaciones:', e.message);
          }
        });
        db.run('ALTER TABLE habitaciones ADD COLUMN nombre TEXT', (e) => {
          if (e && !String(e.message).toLowerCase().includes('duplicate column')) {
            console.error('Migración nombre habitaciones:', e.message);
          }
        });
        db.run('ALTER TABLE habitaciones ADD COLUMN piso TEXT', (e) => {
          if (e && !String(e.message).toLowerCase().includes('duplicate column')) {
            console.error('Migración piso habitaciones:', e.message);
          }
        });
        db.run('ALTER TABLE habitaciones ADD COLUMN precio_diario REAL DEFAULT 0', (e) => {
          if (e && !String(e.message).toLowerCase().includes('duplicate column')) {
            console.error('Migración precio habitaciones:', e.message);
          }
        });
      }
    });

    // Tabla de camas
    db.run(`CREATE TABLE IF NOT EXISTS camas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      habitacion_id INTEGER NOT NULL,
      tipo TEXT NOT NULL,
      numero INTEGER,
      FOREIGN KEY (habitacion_id) REFERENCES habitaciones(id) ON DELETE CASCADE
    )`, (err) => {
      if (err) console.error('Error al crear tabla camas:', err);
    });

    // Tabla de huéspedes
    db.run(`CREATE TABLE IF NOT EXISTS huespedes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      apellido TEXT,
      email TEXT,
      telefono TEXT,
      tipo_documento TEXT DEFAULT 'Cédula',
      documento TEXT,
      fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
      if (err) console.error('Error al crear tabla huespedes:', err);
    });
    db.run("ALTER TABLE huespedes ADD COLUMN tipo_documento TEXT DEFAULT 'Cédula'", (e) => {
      if (e && !String(e.message).toLowerCase().includes('duplicate column')) {
        console.error('Migración tipo documento huéspedes:', e.message);
      }
    });

    // Tabla de reservas
    db.run(`CREATE TABLE IF NOT EXISTS reservas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      habitacion_id INTEGER NOT NULL,
      huesped_id INTEGER NOT NULL,
      adultos INTEGER NOT NULL DEFAULT 1,
      ninos INTEGER NOT NULL DEFAULT 0,
      tipo_habitacion_requerida TEXT,
      metodo_pago TEXT DEFAULT 'Efectivo',
      observaciones TEXT,
      fecha_ingreso DATE NOT NULL,
      fecha_salida DATE NOT NULL,
      estado TEXT NOT NULL DEFAULT 'Activa',
      fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (habitacion_id) REFERENCES habitaciones(id) ON DELETE CASCADE,
      FOREIGN KEY (huesped_id) REFERENCES huespedes(id) ON DELETE CASCADE
    )`, (err) => {
      if (err) console.error('Error al crear tabla reservas:', err);
    });
    db.run("ALTER TABLE reservas ADD COLUMN adultos INTEGER NOT NULL DEFAULT 1", (e) => {
      if (e && !String(e.message).toLowerCase().includes('duplicate column')) {
        console.error('Migración adultos reservas:', e.message);
      }
    });
    db.run("ALTER TABLE reservas ADD COLUMN ninos INTEGER NOT NULL DEFAULT 0", (e) => {
      if (e && !String(e.message).toLowerCase().includes('duplicate column')) {
        console.error('Migración ninos reservas:', e.message);
      }
    });
    db.run("ALTER TABLE reservas ADD COLUMN tipo_habitacion_requerida TEXT", (e) => {
      if (e && !String(e.message).toLowerCase().includes('duplicate column')) {
        console.error('Migración tipo habitación requerida reservas:', e.message);
      }
    });
    db.run("ALTER TABLE reservas ADD COLUMN metodo_pago TEXT DEFAULT 'Efectivo'", (e) => {
      if (e && !String(e.message).toLowerCase().includes('duplicate column')) {
        console.error('Migración método pago reservas:', e.message);
      }
    });
    db.run("ALTER TABLE reservas ADD COLUMN observaciones TEXT", (e) => {
      if (e && !String(e.message).toLowerCase().includes('duplicate column')) {
        console.error('Migración observaciones reservas:', e.message);
      }
    });
    db.run('ALTER TABLE reservas ADD COLUMN tarifa_noche REAL DEFAULT 0', (e) => {
      if (e && !String(e.message).toLowerCase().includes('duplicate column')) {
        console.error('Migración tarifa_noche reservas:', e.message);
      }
    });
    db.run('ALTER TABLE reservas ADD COLUMN monto_abonado REAL DEFAULT 0', (e) => {
      if (e && !String(e.message).toLowerCase().includes('duplicate column')) {
        console.error('Migración monto_abonado reservas:', e.message);
      }
    });

    // Chinchorros (alquiler)
    db.run(`CREATE TABLE IF NOT EXISTS chinchorros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT NOT NULL UNIQUE,
      numero TEXT,
      nombre TEXT,
      tipo TEXT,
      piso TEXT,
      zona TEXT,
      estado TEXT NOT NULL DEFAULT 'Disponible',
      fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
      if (err) {
        console.error('Error al crear tabla chinchorros:', err);
      } else {
        db.run('ALTER TABLE chinchorros ADD COLUMN numero TEXT', (e) => {
          if (e && !String(e.message).toLowerCase().includes('duplicate column')) {
            console.error('Migración numero chinchorros:', e.message);
          }
        });
        db.run('ALTER TABLE chinchorros ADD COLUMN nombre TEXT', (e) => {
          if (e && !String(e.message).toLowerCase().includes('duplicate column')) {
            console.error('Migración nombre chinchorros:', e.message);
          }
        });
        db.run('ALTER TABLE chinchorros ADD COLUMN tipo TEXT', (e) => {
          if (e && !String(e.message).toLowerCase().includes('duplicate column')) {
            console.error('Migración tipo chinchorros:', e.message);
          }
        });
        db.run('ALTER TABLE chinchorros ADD COLUMN piso TEXT', (e) => {
          if (e && !String(e.message).toLowerCase().includes('duplicate column')) {
            console.error('Migración piso chinchorros:', e.message);
          }
        });
        db.run('ALTER TABLE chinchorros ADD COLUMN precio_diario REAL DEFAULT 0', (e) => {
          if (e && !String(e.message).toLowerCase().includes('duplicate column')) {
            console.error('Migración precio chinchorros:', e.message);
          }
        });
      }
    });

    db.run(`CREATE TABLE IF NOT EXISTS reservas_chinchorros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chinchorro_id INTEGER NOT NULL,
      huesped_id INTEGER NOT NULL,
      adultos INTEGER NOT NULL DEFAULT 1,
      ninos INTEGER NOT NULL DEFAULT 0,
      tipo_requerido TEXT,
      metodo_pago TEXT DEFAULT 'Efectivo',
      observaciones TEXT,
      fecha_ingreso DATE NOT NULL,
      fecha_salida DATE NOT NULL,
      estado TEXT NOT NULL DEFAULT 'Activa',
      fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chinchorro_id) REFERENCES chinchorros(id) ON DELETE CASCADE,
      FOREIGN KEY (huesped_id) REFERENCES huespedes(id) ON DELETE CASCADE
    )`, (err) => {
      if (err) console.error('Error al crear tabla reservas_chinchorros:', err);
    });
    db.run("ALTER TABLE reservas_chinchorros ADD COLUMN adultos INTEGER NOT NULL DEFAULT 1", (e) => {
      if (e && !String(e.message).toLowerCase().includes('duplicate column')) {
        console.error('Migración adultos reservas chinchorros:', e.message);
      }
    });
    db.run("ALTER TABLE reservas_chinchorros ADD COLUMN ninos INTEGER NOT NULL DEFAULT 0", (e) => {
      if (e && !String(e.message).toLowerCase().includes('duplicate column')) {
        console.error('Migración ninos reservas chinchorros:', e.message);
      }
    });
    db.run("ALTER TABLE reservas_chinchorros ADD COLUMN tipo_requerido TEXT", (e) => {
      if (e && !String(e.message).toLowerCase().includes('duplicate column')) {
        console.error('Migración tipo requerido reservas chinchorros:', e.message);
      }
    });
    db.run("ALTER TABLE reservas_chinchorros ADD COLUMN metodo_pago TEXT DEFAULT 'Efectivo'", (e) => {
      if (e && !String(e.message).toLowerCase().includes('duplicate column')) {
        console.error('Migración método pago reservas chinchorros:', e.message);
      }
    });
    db.run("ALTER TABLE reservas_chinchorros ADD COLUMN observaciones TEXT", (e) => {
      if (e && !String(e.message).toLowerCase().includes('duplicate column')) {
        console.error('Migración observaciones reservas chinchorros:', e.message);
      }
    });
    db.run('ALTER TABLE reservas_chinchorros ADD COLUMN tarifa_dia REAL DEFAULT 0', (e) => {
      if (e && !String(e.message).toLowerCase().includes('duplicate column')) {
        console.error('Migración tarifa_dia reservas chinchorros:', e.message);
      }
    });
    db.run('ALTER TABLE reservas_chinchorros ADD COLUMN monto_abonado REAL DEFAULT 0', (e) => {
      if (e && !String(e.message).toLowerCase().includes('duplicate column')) {
        console.error('Migración monto_abonado reservas chinchorros:', e.message);
      }
    });

    // Tabla de usuarios (rol: administrador | operador)
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      nombre TEXT,
      email TEXT,
      activo INTEGER DEFAULT 1,
      rol TEXT NOT NULL DEFAULT 'operador',
      fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
      ultimo_acceso DATETIME
    )`, (err) => {
      if (err) {
        console.error('Error al crear tabla usuarios:', err);
      } else {
        db.get("SELECT COUNT(*) as count FROM usuarios", (err, row) => {
          if (!err && row.count === 0) {
            const defaultPassword = 'admin123';
            hashPasswordLogin(defaultPassword, (err, hash, sha) => {
              if (!err) {
                db.run(
                  "INSERT INTO usuarios (username, password, password_sha256_ci, nombre, rol) VALUES (?, ?, ?, ?, ?)",
                  ['admin', hash, sha, 'Administrador', 'administrador'],
                  (err) => {
                    if (err) {
                      console.error('Error al crear usuario por defecto:', err);
                    } else {
                      console.log('Usuario por defecto creado: admin / admin123 (rol administrador)');
                    }
                  }
                );
              }
            });
          }
        });
      }
    });

    db.run(`ALTER TABLE usuarios ADD COLUMN rol TEXT DEFAULT 'operador'`, (err) => {
      if (err && !String(err.message).toLowerCase().includes('duplicate column')) {
        console.error('Migración columna rol:', err.message);
      }
    });
    db.run(`ALTER TABLE usuarios ADD COLUMN password_sha256_ci TEXT`, (err) => {
      if (err && !String(err.message).toLowerCase().includes('duplicate column')) {
        console.error('Migración columna password_sha256_ci:', err.message);
      }
    });
    db.run(`ALTER TABLE usuarios ADD COLUMN activo INTEGER DEFAULT 1`, (err) => {
      if (err && !String(err.message).toLowerCase().includes('duplicate column')) {
        console.error('Migración columna activo:', err.message);
      }
      db.run(`UPDATE usuarios SET rol = 'operador' WHERE rol IS NULL OR TRIM(COALESCE(rol,'')) = ''`, () => {
        db.run(`UPDATE usuarios SET rol = LOWER(TRIM(rol)) WHERE rol IS NOT NULL`, () => {
          db.run(`UPDATE usuarios SET rol = 'operador' WHERE rol NOT IN ('administrador', 'operador')`, () => {
            db.run(`UPDATE usuarios SET activo = 1 WHERE activo IS NULL`, () => {
              db.get(
                "SELECT COUNT(*) as c FROM usuarios WHERE rol = 'administrador' AND activo = 1",
                (e, row) => {
                  if (!e && row && row.c === 0) {
                    db.run("UPDATE usuarios SET rol = 'administrador' WHERE username = 'admin'");
                  }
                }
              );
            });
          });
        });
      });
    });

    migrarContrasenasSinMayusculasTodosRoles((migErr) => {
      if (migErr) {
        console.warn('Migración claves sin mayúsculas:', migErr.message);
      }
    });
  });
}

function getHotel(callback) {
  db.get("SELECT * FROM hotel ORDER BY id DESC LIMIT 1", callback);
}

/** Garantiza al menos una fila en `hotel` (INSERT por defecto si la tabla está vacía). */
function ensureHotelRow(callback) {
  getHotel((err, row) => {
    if (err) {
      return callback(err);
    }
    if (row) {
      return callback(null, row);
    }
    db.run("INSERT INTO hotel (nombre) VALUES ('Mi Hotel')", function (runErr) {
      if (runErr) {
        return callback(runErr);
      }
      getHotel(callback);
    });
  });
}

function updateHotelNombre(nombre, callback) {
  ensureHotelRow((err) => {
    if (err) {
      return callback(err);
    }
    db.run(
      "UPDATE hotel SET nombre = ?, fecha_actualizacion = CURRENT_TIMESTAMP WHERE id = (SELECT id FROM hotel ORDER BY id DESC LIMIT 1)",
      [nombre],
      callback
    );
  });
}

  /** Garantiza columnas de apariencia (por si la BD existía antes de la migración). */
function ensureHotelThemeColumns(callback) {
  db.all('PRAGMA table_info(hotel)', (err, rows) => {
    if (err) {
      return callback(err);
    }
    const have = new Set(rows.map((r) => r.name));
    const cols = ['color_primario', 'color_secundario', 'color_acento', 'color_titulo', 'fondo_imagen_url', 'logo_url'];
    const sqls = cols
      .filter((c) => !have.has(c))
      .map((c) => `ALTER TABLE hotel ADD COLUMN ${c} TEXT`);
    function runNext(i) {
      if (i >= sqls.length) {
        return callback(null);
      }
      db.run(sqls[i], (e) => {
        if (e && !String(e.message).toLowerCase().includes('duplicate column')) {
          return callback(e);
        }
        runNext(i + 1);
      });
    }
    runNext(0);
  });
}

function updateHotelLogoUrl(logo_url, callback) {
  ensureHotelRow((eRow) => {
    if (eRow) {
      return callback(eRow);
    }
    ensureHotelThemeColumns((err) => {
      if (err) {
        return callback(err);
      }
      db.run(
        `UPDATE hotel
         SET logo_url = ?,
             fecha_actualizacion = CURRENT_TIMESTAMP
         WHERE id = (SELECT id FROM hotel ORDER BY id DESC LIMIT 1)`,
        [logo_url],
        callback
      );
    });
  });
}

function updateHotelVistas(vista_habitaciones, vista_chinchorros, callback) {
  ensureHotelRow((err) => {
    if (err) {
      return callback(err);
    }
    db.run(
      `UPDATE hotel SET vista_habitaciones = ?, vista_chinchorros = ?, fecha_actualizacion = CURRENT_TIMESTAMP WHERE id = (SELECT id FROM hotel ORDER BY id DESC LIMIT 1)`,
      [vista_habitaciones, vista_chinchorros],
      callback
    );
  });
}

/**
 * Apariencia del hotel (colores + fondo).
 * `fondo_imagen_url` puede ser URL absoluta http/https o ruta local que comience con `/`.
 */
function updateHotelApariencia(color_primario, color_secundario, color_acento, color_titulo, fondo_imagen_url, callback) {
  ensureHotelRow((eRow) => {
    if (eRow) {
      return callback(eRow);
    }
    ensureHotelThemeColumns((err) => {
      if (err) {
        return callback(err);
      }
      db.run(
        `UPDATE hotel
         SET color_primario = ?,
             color_secundario = ?,
             color_acento = ?,
             color_titulo = ?,
             fondo_imagen_url = ?,
             fecha_actualizacion = CURRENT_TIMESTAMP
         WHERE id = (SELECT id FROM hotel ORDER BY id DESC LIMIT 1)`,
        [color_primario, color_secundario, color_acento, color_titulo, fondo_imagen_url],
        callback
      );
    });
  });
}

// Funciones para Habitaciones
function getAllHabitaciones(callback) {
  db.all(`
    SELECT h.*, 
           COUNT(DISTINCT c.id) as total_camas,
           COUNT(DISTINCT r.id) as reservas_activas
    FROM habitaciones h
    LEFT JOIN camas c ON h.id = c.habitacion_id
    LEFT JOIN reservas r ON h.id = r.habitacion_id AND r.estado = 'Activa' 
      AND DATE('now') BETWEEN r.fecha_ingreso AND r.fecha_salida
    GROUP BY h.id
    ORDER BY h.numero
  `, callback);
}

function getHabitacionById(id, callback) {
  db.get("SELECT * FROM habitaciones WHERE id = ?", [id], callback);
}

function createHabitacion(codigo, numero, nombre, tipo, piso, estado, precio_diario, callback) {
  const p = precio_diario == null || precio_diario === '' ? 0 : Number(precio_diario);
  const precio = Number.isFinite(p) && p >= 0 ? p : 0;
  const est = estado || 'Disponible';
  db.run(
    "INSERT INTO habitaciones (codigo, numero, nombre, tipo, piso, estado, precio_diario) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [codigo, numero, nombre || null, tipo, piso || null, est, precio],
    function(err) {
      if (err) {
        callback(err);
      } else {
        callback(null, { id: this.lastID, codigo, numero, nombre, tipo, piso, estado: est, precio_diario: precio });
      }
    }
  );
}

function updateHabitacionDatos(id, codigo, numero, nombre, tipo, piso, estado, precio_diario, callback) {
  const p = precio_diario == null || precio_diario === '' ? 0 : Number(precio_diario);
  const precio = Number.isFinite(p) && p >= 0 ? p : 0;
  const cod = codigo != null ? String(codigo).trim() : '';
  const codigoSeguro = cod || `HAB-${id}`;
  const numRaw = numero != null ? String(numero).trim() : '';
  const nomRaw = nombre != null ? String(nombre).trim() : '';
  const numeroSeguro = numRaw || codigoSeguro || nomRaw || `HAB-${id}`;
  db.run(
    'UPDATE habitaciones SET codigo = ?, numero = ?, nombre = ?, tipo = ?, piso = ?, estado = ?, precio_diario = ? WHERE id = ?',
    [codigoSeguro, numeroSeguro, nombre || null, tipo || 'Sencilla', piso || null, estado || 'Disponible', precio, id],
    callback
  );
}

function updateHabitacionEstado(id, estado, callback) {
  db.run("UPDATE habitaciones SET estado = ? WHERE id = ?", [estado, id], callback);
}

/** Reserva activa que incluye la fecha de hoy para la habitación. */
function habitacionTieneReservaActivaHoy(habitacion_id, callback) {
  db.get(
    `
      SELECT COUNT(*) as count FROM reservas
      WHERE habitacion_id = ?
      AND estado = 'Activa'
      AND DATE('now') BETWEEN fecha_ingreso AND fecha_salida
    `,
    [habitacion_id],
    (err, row) => {
      if (err) return callback(err);
      callback(null, row && Number(row.count) > 0);
    }
  );
}

function deleteHabitacion(id, callback) {
  db.run("DELETE FROM habitaciones WHERE id = ?", [id], callback);
}

// Funciones para Camas
function getCamasByHabitacion(habitacion_id, callback) {
  db.all("SELECT * FROM camas WHERE habitacion_id = ? ORDER BY numero", [habitacion_id], callback);
}

function createCama(habitacion_id, tipo, numero, callback) {
  db.run("INSERT INTO camas (habitacion_id, tipo, numero) VALUES (?, ?, ?)", 
    [habitacion_id, tipo, numero], function(err) {
    if (err) {
      callback(err);
    } else {
      callback(null, { id: this.lastID, habitacion_id, tipo, numero });
    }
  });
}

function deleteCama(id, callback) {
  db.run("DELETE FROM camas WHERE id = ?", [id], callback);
}

// Funciones para Huéspedes
function getAllHuespedes(callback) {
  db.all("SELECT * FROM huespedes ORDER BY nombre, apellido", callback);
}

function getHuespedById(id, callback) {
  db.get("SELECT * FROM huespedes WHERE id = ?", [id], callback);
}

function createHuesped(nombre, apellido, email, telefono, tipo_documento, documento, callback) {
  db.run("INSERT INTO huespedes (nombre, apellido, email, telefono, tipo_documento, documento) VALUES (?, ?, ?, ?, ?, ?)", 
    [nombre, apellido, email, telefono, tipo_documento || 'Cédula', documento], function(err) {
    if (err) {
      callback(err);
    } else {
      callback(null, { 
        id: this.lastID, 
        nombre, 
        apellido, 
        email, 
        telefono, 
        tipo_documento: tipo_documento || 'Cédula',
        documento 
      });
    }
  });
}

function updateHuesped(id, nombre, apellido, email, telefono, tipo_documento, documento, callback) {
  db.run(
    "UPDATE huespedes SET nombre = ?, apellido = ?, email = ?, telefono = ?, tipo_documento = ?, documento = ? WHERE id = ?",
    [nombre, apellido, email, telefono, tipo_documento || 'Cédula', documento, id],
    function(err) {
      if (err) {
        callback(err);
      } else {
        callback(null, { id, nombre, apellido, email, telefono, tipo_documento: tipo_documento || 'Cédula', documento });
      }
    }
  );
}

function deleteHuesped(id, callback) {
  db.run("DELETE FROM huespedes WHERE id = ?", [id], callback);
}

// Funciones para Reservas
function unidadesEstadiaYMD(fechaIngreso, fechaSalida) {
  const a = new Date(String(fechaIngreso).slice(0, 10));
  const b = new Date(String(fechaSalida).slice(0, 10));
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 1;
  const days = Math.round((b - a) / (24 * 3600 * 1000));
  return Math.max(1, days);
}

function calcularTotalReservaHabitacionRow(row) {
  if (!row) return 0;
  const tarifaRaw =
    row.tarifa_noche != null && Number(row.tarifa_noche) > 0
      ? Number(row.tarifa_noche)
      : row.habitacion_precio_diario != null
        ? Number(row.habitacion_precio_diario)
        : Number(row.precio_diario || 0);
  if (!Number.isFinite(tarifaRaw) || tarifaRaw <= 0) return 0;
  return tarifaRaw * unidadesEstadiaYMD(row.fecha_ingreso, row.fecha_salida);
}

function calcularTotalReservaChinchorroRow(row) {
  if (!row) return 0;
  const tarifaRaw =
    row.tarifa_dia != null && Number(row.tarifa_dia) > 0
      ? Number(row.tarifa_dia)
      : row.chinchorro_precio_diario != null
        ? Number(row.chinchorro_precio_diario)
        : Number(row.precio_diario || 0);
  if (!Number.isFinite(tarifaRaw) || tarifaRaw <= 0) return 0;
  return tarifaRaw * unidadesEstadiaYMD(row.fecha_ingreso, row.fecha_salida);
}

function normalizarMontoAbonado(monto, total) {
  const t = Number.isFinite(Number(total)) && Number(total) >= 0 ? Number(total) : 0;
  const m = Number.isFinite(Number(monto)) && Number(monto) >= 0 ? Number(monto) : 0;
  return Math.min(t, m);
}

function getReservaPagoContext(id, callback) {
  db.get(
    `
      SELECT r.*,
             COALESCE(NULLIF(r.tarifa_noche, 0), h.precio_diario, 0) as habitacion_precio_diario
      FROM reservas r
      JOIN habitaciones h ON r.habitacion_id = h.id
      WHERE r.id = ?
    `,
    [id],
    callback
  );
}

function getReservaChinchorroPagoContext(id, callback) {
  db.get(
    `
      SELECT r.*,
             COALESCE(NULLIF(r.tarifa_dia, 0), ch.precio_diario, 0) as chinchorro_precio_diario
      FROM reservas_chinchorros r
      JOIN chinchorros ch ON r.chinchorro_id = ch.id
      WHERE r.id = ?
    `,
    [id],
    callback
  );
}

function getAllReservas(callback) {
  db.all(`
    SELECT r.*,
           h.numero as habitacion_numero,
           h.nombre as habitacion_nombre,
           COALESCE(NULLIF(r.tarifa_noche, 0), h.precio_diario, 0) as habitacion_precio_diario,
           r.tarifa_noche as reserva_tarifa_noche,
           hu.nombre as huesped_nombre,
           hu.apellido as huesped_apellido,
           hu.email as huesped_email
    FROM reservas r
    JOIN habitaciones h ON r.habitacion_id = h.id
    JOIN huespedes hu ON r.huesped_id = hu.id
    ORDER BY r.fecha_ingreso DESC
  `, callback);
}

function getReservaById(id, callback) {
  db.get('SELECT * FROM reservas WHERE id = ?', [id], callback);
}

/**
 * Calcula estado de inventario según reservas activas:
 * - Ocupada: reserva activa que incluye hoy
 * - Reservada: reserva activa futura (sin ocupar hoy)
 * - Disponible: sin reservas activas relevantes
 * Conserva Fuera de servicio y En limpieza si no hay ocupación hoy.
 */
function resolverEstadoInventarioDesdeReservas(estadoActual, cntHoy, cntFuturo) {
  const est = String(estadoActual || 'Disponible');
  if (est === 'Fuera de servicio') return 'Fuera de servicio';
  if (est === 'En limpieza') return 'En limpieza';
  if (Number(cntHoy) > 0) return 'Ocupada';
  if (Number(cntFuturo) > 0) return 'Reservada';
  return 'Disponible';
}

function sincronizarEstadoHabitacionConReservas(habitacion_id, callback) {
  getHabitacionById(habitacion_id, (e0, hab) => {
    if (e0) return callback(e0);
    if (!hab) return callback(new Error('Habitación no encontrada'));
    db.get(
      `
        SELECT
          SUM(CASE WHEN DATE('now') BETWEEN fecha_ingreso AND fecha_salida THEN 1 ELSE 0 END) as cnt_hoy,
          SUM(CASE WHEN DATE('now') < fecha_ingreso THEN 1 ELSE 0 END) as cnt_futuro
        FROM reservas
        WHERE habitacion_id = ? AND estado = 'Activa'
      `,
      [habitacion_id],
      (err, agg) => {
        if (err) return callback(err);
        const nuevo = resolverEstadoInventarioDesdeReservas(
          hab.estado,
          agg && agg.cnt_hoy,
          agg && agg.cnt_futuro
        );
        if (nuevo === hab.estado) return callback(null);
        updateHabitacionEstado(habitacion_id, nuevo, callback);
      }
    );
  });
}

function mensajeInventarioNoReservable(estado, tipo) {
  const e = String(estado || '').trim();
  if (e !== 'En limpieza' && e !== 'Fuera de servicio') return null;
  const unidad = tipo === 'chinchorro' ? 'El chinchorro' : 'La habitación';
  return `${unidad} está en limpieza o fuera de servicio y no admite reservas.`;
}

function updateReservaDatos(id, habitacion_id, huesped_id, adultos, ninos, tipo_habitacion_requerida, metodo_pago, observaciones, fecha_ingreso, fecha_salida, tarifa_noche, callback) {
  const tarifaRaw = tarifa_noche == null || tarifa_noche === '' ? 0 : Number(tarifa_noche);
  const tarifaSegura = Number.isFinite(tarifaRaw) && tarifaRaw >= 0 ? tarifaRaw : 0;
  getReservaById(id, (err, curr) => {
    if (err) {
      return callback(err);
    }
    if (!curr) {
      return callback(new Error('Reserva no encontrada'));
    }
    const roomAnt = curr.habitacion_id;

    const aplicarActualizacion = () => {
      const ejecutarUpdate = () => {
      db.run(
        'UPDATE reservas SET habitacion_id = ?, huesped_id = ?, adultos = ?, ninos = ?, tipo_habitacion_requerida = ?, metodo_pago = ?, observaciones = ?, fecha_ingreso = ?, fecha_salida = ?, tarifa_noche = ? WHERE id = ?',
        [habitacion_id, huesped_id, adultos, ninos, tipo_habitacion_requerida, metodo_pago, observaciones, fecha_ingreso, fecha_salida, tarifaSegura, id],
        (runErr) => {
          if (runErr) {
            callback(runErr);
            return;
          }
          sincronizarEstadoHabitacionConReservas(roomAnt, (e1) => {
            if (e1) return callback(e1);
            const syncNueva = () => {
              if (Number(roomAnt) === Number(habitacion_id)) {
                return ajustarMontoAbonadoReserva(id, callback);
              }
              sincronizarEstadoHabitacionConReservas(habitacion_id, (e2) => {
                if (e2) return callback(e2);
                ajustarMontoAbonadoReserva(id, callback);
              });
            };
            syncNueva();
          });
        }
      );
      };

      if (Number(roomAnt) === Number(habitacion_id)) {
        return ejecutarUpdate();
      }
      getHabitacionById(habitacion_id, (errHab, hab) => {
        if (errHab) return callback(errHab);
        if (!hab) return callback(new Error('Habitación no encontrada'));
        const msgEst = mensajeInventarioNoReservable(hab.estado, 'habitacion');
        if (msgEst) return callback(new Error(msgEst));
        ejecutarUpdate();
      });
    };

    if (String(curr.estado) === 'Activa') {
      db.all(
        `
          SELECT * FROM reservas 
          WHERE habitacion_id = ?
          AND estado = 'Activa'
          AND id != ?
          AND fecha_ingreso < ?
          AND fecha_salida > ?
        `,
        [habitacion_id, id, fecha_salida, fecha_ingreso],
        (ovErr, rows) => {
          if (ovErr) {
            return callback(ovErr);
          }
          if (rows && rows.length > 0) {
            return callback(new Error('La habitación ya está reservada en esas fechas'));
          }
          aplicarActualizacion();
        }
      );
    } else {
      aplicarActualizacion();
    }
  });
}

function ajustarMontoAbonadoReserva(id, callback) {
  getReservaPagoContext(id, (err, row) => {
    if (err) return callback(err);
    if (!row) return callback(new Error('Reserva no encontrada'));
    const total = calcularTotalReservaHabitacionRow(row);
    const abono = normalizarMontoAbonado(row.monto_abonado, total);
    db.run('UPDATE reservas SET monto_abonado = ? WHERE id = ?', [abono, id], callback);
  });
}

function registrarAbonoReserva(id, monto, callback) {
  const extra = Number(monto);
  if (!Number.isFinite(extra) || extra <= 0) {
    return callback(new Error('Indique un monto de abono mayor a cero'));
  }
  getReservaPagoContext(id, (err, row) => {
    if (err) return callback(err);
    if (!row) return callback(new Error('Reserva no encontrada'));
    if (String(row.estado) === 'Cancelada') {
      return callback(new Error('No se puede abonar una reserva cancelada'));
    }
    const total = calcularTotalReservaHabitacionRow(row);
    if (total <= 0) return callback(new Error('La reserva no tiene un total calculable'));
    const actual = Number(row.monto_abonado || 0);
    if (actual >= total - 0.005) {
      return callback(new Error('La reserva ya está totalizada'));
    }
    const nuevo = normalizarMontoAbonado(actual + extra, total);
    db.run('UPDATE reservas SET monto_abonado = ? WHERE id = ?', [nuevo, id], (runErr) => {
      if (runErr) return callback(runErr);
      callback(null, { id, monto_abonado: nuevo, total, saldo: Math.max(0, total - nuevo) });
    });
  });
}

function totalizarReserva(id, callback) {
  getReservaPagoContext(id, (err, row) => {
    if (err) return callback(err);
    if (!row) return callback(new Error('Reserva no encontrada'));
    if (String(row.estado) === 'Cancelada') {
      return callback(new Error('No se puede totalizar una reserva cancelada'));
    }
    const total = calcularTotalReservaHabitacionRow(row);
    if (total <= 0) return callback(new Error('La reserva no tiene un total calculable'));
    db.run('UPDATE reservas SET monto_abonado = ? WHERE id = ?', [total, id], (runErr) => {
      if (runErr) return callback(runErr);
      callback(null, { id, monto_abonado: total, total, saldo: 0 });
    });
  });
}

function createReserva(habitacion_id, huesped_id, adultos, ninos, tipo_habitacion_requerida, metodo_pago, observaciones, fecha_ingreso, fecha_salida, tarifa_noche, monto_abonado, callback) {
  getHabitacionById(habitacion_id, (errHab, hab) => {
    if (errHab) return callback(errHab);
    if (!hab) return callback(new Error('Habitación no encontrada'));
    const msgEst = mensajeInventarioNoReservable(hab.estado, 'habitacion');
    if (msgEst) return callback(new Error(msgEst));

  // Verificar que la habitación esté disponible en esas fechas
  // Dos reservas se solapan si: (inicio1 < fin2) AND (inicio2 < fin1)
  db.all(`
    SELECT * FROM reservas 
    WHERE habitacion_id = ? 
    AND estado = 'Activa'
    AND fecha_ingreso < ? 
    AND fecha_salida > ?
  `, [habitacion_id, fecha_salida, fecha_ingreso], (err, rows) => {
    if (err) {
      callback(err);
    } else if (rows.length > 0) {
      callback(new Error('La habitación ya está reservada en esas fechas'));
    } else {
      const tarifa = tarifa_noche == null || tarifa_noche === '' ? 0 : Number(tarifa_noche);
      const tarifaSegura = Number.isFinite(tarifa) && tarifa >= 0 ? tarifa : 0;
      const totalEst = tarifaSegura * unidadesEstadiaYMD(fecha_ingreso, fecha_salida);
      const abonoInicial = normalizarMontoAbonado(monto_abonado, totalEst);
      db.run("INSERT INTO reservas (habitacion_id, huesped_id, adultos, ninos, tipo_habitacion_requerida, metodo_pago, observaciones, fecha_ingreso, fecha_salida, tarifa_noche, monto_abonado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", 
        [habitacion_id, huesped_id, adultos, ninos, tipo_habitacion_requerida, metodo_pago, observaciones, fecha_ingreso, fecha_salida, tarifaSegura, abonoInicial], function(err) {
        if (err) {
          callback(err);
        } else {
          sincronizarEstadoHabitacionConReservas(habitacion_id, (syncErr) => {
            if (syncErr) {
              callback(syncErr);
              return;
            }
            callback(null, { 
            id: this.lastID, 
            habitacion_id, 
            huesped_id, 
            adultos,
            ninos,
            tipo_habitacion_requerida,
            metodo_pago,
            observaciones,
            fecha_ingreso, 
            fecha_salida,
            tarifa_noche: tarifaSegura,
            monto_abonado: abonoInicial,
            estado: 'Activa'
          });
          });
        }
      });
    }
  });
  });
}

function updateReservaEstado(id, estado, callback) {
  db.run('UPDATE reservas SET estado = ? WHERE id = ?', [estado, id], function(err) {
    if (err) {
      return callback(err);
    }
    db.get('SELECT habitacion_id FROM reservas WHERE id = ?', [id], (err2, row) => {
      if (err2) return callback(err2);
      if (!row) return callback(null);
      sincronizarEstadoHabitacionConReservas(row.habitacion_id, (syncErr) => callback(syncErr || null));
    });
  });
}

function deleteReserva(id, callback) {
  db.get("SELECT habitacion_id FROM reservas WHERE id = ?", [id], (err, row) => {
    if (err) {
      callback(err);
    } else {
      db.run("DELETE FROM reservas WHERE id = ?", [id], function(err) {
        if (!err && row) {
          sincronizarEstadoHabitacionConReservas(row.habitacion_id, () => {});
        }
        callback(err);
      });
    }
  });
}

// ========== Chinchorros ==========
function updateChinchorroEstado(id, estado, callback) {
  db.run("UPDATE chinchorros SET estado = ? WHERE id = ?", [estado, id], callback);
}

function getAllChinchorros(callback) {
  db.all(`
    SELECT ch.*,
           COUNT(DISTINCT rc.id) as reservas_activas
    FROM chinchorros ch
    LEFT JOIN reservas_chinchorros rc ON ch.id = rc.chinchorro_id AND rc.estado = 'Activa'
      AND DATE('now') BETWEEN rc.fecha_ingreso AND rc.fecha_salida
    GROUP BY ch.id
    ORDER BY ch.codigo
  `, callback);
}

function createChinchorro(codigo, numero, nombre, tipo, piso, estado, precio_diario, callback) {
  const p = precio_diario == null || precio_diario === '' ? 0 : Number(precio_diario);
  const precio = Number.isFinite(p) && p >= 0 ? p : 0;
  const est = estado || 'Disponible';
  db.run(
    "INSERT INTO chinchorros (codigo, numero, nombre, tipo, piso, estado, precio_diario) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [codigo, numero || null, nombre || null, tipo || 'Sencilla', piso || null, est, precio],
    function(err) {
      if (err) {
        callback(err);
      } else {
        callback(null, {
          id: this.lastID,
          codigo,
          numero: numero || null,
          nombre: nombre || null,
          tipo: tipo || 'Sencilla',
          piso: piso || null,
          estado: est,
          precio_diario: precio
        });
      }
    }
  );
}

function updateChinchorroDatos(id, codigo, numero, nombre, tipo, piso, estado, precio_diario, callback) {
  const p = precio_diario == null || precio_diario === '' ? 0 : Number(precio_diario);
  const precio = Number.isFinite(p) && p >= 0 ? p : 0;
  const cod = codigo != null ? String(codigo).trim() : '';
  const codigoSeguro = cod || `CH-${id}`;
  const numRaw = numero != null ? String(numero).trim() : '';
  const nomRaw = nombre != null ? String(nombre).trim() : '';
  const numeroSeguro = numRaw || codigoSeguro || nomRaw || `CH-${id}`;
  db.run(
    'UPDATE chinchorros SET codigo = ?, numero = ?, nombre = ?, tipo = ?, piso = ?, estado = ?, precio_diario = ? WHERE id = ?',
    [codigoSeguro, numeroSeguro, nombre || null, tipo || 'Sencilla', piso || null, estado || 'Disponible', precio, id],
    callback
  );
}

function deleteChinchorro(id, callback) {
  db.run("DELETE FROM chinchorros WHERE id = ?", [id], callback);
}

function getChinchorroById(id, callback) {
  db.get('SELECT * FROM chinchorros WHERE id = ?', [id], callback);
}

function chinchorroTieneReservaActivaHoy(chinchorro_id, callback) {
  db.get(
    `
      SELECT COUNT(*) as count FROM reservas_chinchorros
      WHERE chinchorro_id = ?
      AND estado = 'Activa'
      AND DATE('now') BETWEEN fecha_ingreso AND fecha_salida
    `,
    [chinchorro_id],
    (err, row) => {
      if (err) return callback(err);
      callback(null, row && Number(row.count) > 0);
    }
  );
}

function getAllReservasChinchorros(callback) {
  db.all(
    `
    SELECT r.*,
           ch.codigo as chinchorro_codigo,
           ch.nombre as chinchorro_nombre,
           COALESCE(NULLIF(r.tarifa_dia, 0), ch.precio_diario, 0) as chinchorro_precio_diario,
           r.tarifa_dia as reserva_tarifa_dia,
           hu.nombre as huesped_nombre,
           hu.apellido as huesped_apellido,
           hu.email as huesped_email
    FROM reservas_chinchorros r
    JOIN chinchorros ch ON r.chinchorro_id = ch.id
    JOIN huespedes hu ON r.huesped_id = hu.id
    ORDER BY r.fecha_ingreso DESC
  `,
    callback
  );
}

function ajustarMontoAbonadoReservaChinchorro(id, callback) {
  getReservaChinchorroPagoContext(id, (err, row) => {
    if (err) return callback(err);
    if (!row) return callback(new Error('Reserva no encontrada'));
    const total = calcularTotalReservaChinchorroRow(row);
    const abono = normalizarMontoAbonado(row.monto_abonado, total);
    db.run('UPDATE reservas_chinchorros SET monto_abonado = ? WHERE id = ?', [abono, id], callback);
  });
}

function registrarAbonoReservaChinchorro(id, monto, callback) {
  const extra = Number(monto);
  if (!Number.isFinite(extra) || extra <= 0) {
    return callback(new Error('Indique un monto de abono mayor a cero'));
  }
  getReservaChinchorroPagoContext(id, (err, row) => {
    if (err) return callback(err);
    if (!row) return callback(new Error('Reserva no encontrada'));
    if (String(row.estado) === 'Cancelada') {
      return callback(new Error('No se puede abonar una reserva cancelada'));
    }
    const total = calcularTotalReservaChinchorroRow(row);
    if (total <= 0) return callback(new Error('La reserva no tiene un total calculable'));
    const actual = Number(row.monto_abonado || 0);
    if (actual >= total - 0.005) {
      return callback(new Error('La reserva ya está totalizada'));
    }
    const nuevo = normalizarMontoAbonado(actual + extra, total);
    db.run('UPDATE reservas_chinchorros SET monto_abonado = ? WHERE id = ?', [nuevo, id], (runErr) => {
      if (runErr) return callback(runErr);
      callback(null, { id, monto_abonado: nuevo, total, saldo: Math.max(0, total - nuevo) });
    });
  });
}

function totalizarReservaChinchorro(id, callback) {
  getReservaChinchorroPagoContext(id, (err, row) => {
    if (err) return callback(err);
    if (!row) return callback(new Error('Reserva no encontrada'));
    if (String(row.estado) === 'Cancelada') {
      return callback(new Error('No se puede totalizar una reserva cancelada'));
    }
    const total = calcularTotalReservaChinchorroRow(row);
    if (total <= 0) return callback(new Error('La reserva no tiene un total calculable'));
    db.run('UPDATE reservas_chinchorros SET monto_abonado = ? WHERE id = ?', [total, id], (runErr) => {
      if (runErr) return callback(runErr);
      callback(null, { id, monto_abonado: total, total, saldo: 0 });
    });
  });
}

function createReservaChinchorro(chinchorro_id, huesped_id, adultos, ninos, tipo_requerido, metodo_pago, observaciones, fecha_ingreso, fecha_salida, tarifa_dia, monto_abonado, callback) {
  getChinchorroById(chinchorro_id, (errCh, ch) => {
    if (errCh) return callback(errCh);
    if (!ch) return callback(new Error('Chinchorro no encontrado'));
    const msgEst = mensajeInventarioNoReservable(ch.estado, 'chinchorro');
    if (msgEst) return callback(new Error(msgEst));

  db.all(`
    SELECT * FROM reservas_chinchorros
    WHERE chinchorro_id = ?
    AND estado = 'Activa'
    AND fecha_ingreso < ?
    AND fecha_salida > ?
  `, [chinchorro_id, fecha_salida, fecha_ingreso], (err, rows) => {
    if (err) {
      callback(err);
    } else if (rows.length > 0) {
      callback(new Error('El chinchorro ya está reservado en esas fechas'));
    } else {
      const tarifaRaw = tarifa_dia == null || tarifa_dia === '' ? 0 : Number(tarifa_dia);
      const tarifaSegura = Number.isFinite(tarifaRaw) && tarifaRaw >= 0 ? tarifaRaw : 0;
      const totalEst = tarifaSegura * unidadesEstadiaYMD(fecha_ingreso, fecha_salida);
      const abonoInicial = normalizarMontoAbonado(monto_abonado, totalEst);
      db.run(
        "INSERT INTO reservas_chinchorros (chinchorro_id, huesped_id, adultos, ninos, tipo_requerido, metodo_pago, observaciones, fecha_ingreso, fecha_salida, tarifa_dia, monto_abonado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [chinchorro_id, huesped_id, adultos, ninos, tipo_requerido, metodo_pago, observaciones, fecha_ingreso, fecha_salida, tarifaSegura, abonoInicial],
        function(err) {
          if (err) {
            callback(err);
          } else {
            sincronizarEstadoChinchorroConReservas(chinchorro_id, (syncErr) => {
              if (syncErr) {
                callback(syncErr);
                return;
              }
              callback(null, {
                id: this.lastID,
                chinchorro_id,
                huesped_id,
                adultos,
                ninos,
                tipo_requerido,
                metodo_pago,
                observaciones,
                fecha_ingreso,
                fecha_salida,
                tarifa_dia: tarifaSegura,
                monto_abonado: abonoInicial,
                estado: 'Activa'
              });
            });
          }
        }
      );
    }
  });
  });
}

function getReservaChinchorroById(id, callback) {
  db.get('SELECT * FROM reservas_chinchorros WHERE id = ?', [id], callback);
}

function sincronizarEstadoChinchorroConReservas(chinchorro_id, callback) {
  getChinchorroById(chinchorro_id, (e0, ch) => {
    if (e0) return callback(e0);
    if (!ch) return callback(new Error('Chinchorro no encontrado'));
    db.get(
      `
        SELECT
          SUM(CASE WHEN DATE('now') BETWEEN fecha_ingreso AND fecha_salida THEN 1 ELSE 0 END) as cnt_hoy,
          SUM(CASE WHEN DATE('now') < fecha_ingreso THEN 1 ELSE 0 END) as cnt_futuro
        FROM reservas_chinchorros
        WHERE chinchorro_id = ? AND estado = 'Activa'
      `,
      [chinchorro_id],
      (err, agg) => {
        if (err) return callback(err);
        const nuevo = resolverEstadoInventarioDesdeReservas(
          ch.estado,
          agg && agg.cnt_hoy,
          agg && agg.cnt_futuro
        );
        if (nuevo === ch.estado) return callback(null);
        updateChinchorroEstado(chinchorro_id, nuevo, callback);
      }
    );
  });
}

function updateReservaChinchorroDatos(id, chinchorro_id, huesped_id, adultos, ninos, tipo_requerido, metodo_pago, observaciones, fecha_ingreso, fecha_salida, tarifa_dia, callback) {
  const tarifaRaw = tarifa_dia == null || tarifa_dia === '' ? 0 : Number(tarifa_dia);
  const tarifaSegura = Number.isFinite(tarifaRaw) && tarifaRaw >= 0 ? tarifaRaw : 0;
  getReservaChinchorroById(id, (err, curr) => {
    if (err) {
      return callback(err);
    }
    if (!curr) {
      return callback(new Error('Reserva no encontrada'));
    }
    const chAnt = curr.chinchorro_id;

    const aplicarActualizacion = () => {
      const ejecutarUpdate = () => {
      db.run(
        'UPDATE reservas_chinchorros SET chinchorro_id = ?, huesped_id = ?, adultos = ?, ninos = ?, tipo_requerido = ?, metodo_pago = ?, observaciones = ?, fecha_ingreso = ?, fecha_salida = ?, tarifa_dia = ? WHERE id = ?',
        [chinchorro_id, huesped_id, adultos, ninos, tipo_requerido, metodo_pago, observaciones, fecha_ingreso, fecha_salida, tarifaSegura, id],
        (runErr) => {
          if (runErr) {
            callback(runErr);
            return;
          }
          sincronizarEstadoChinchorroConReservas(chAnt, (e1) => {
            if (e1) return callback(e1);
            const syncNueva = () => {
              if (Number(chAnt) === Number(chinchorro_id)) {
                return ajustarMontoAbonadoReservaChinchorro(id, callback);
              }
              sincronizarEstadoChinchorroConReservas(chinchorro_id, (e2) => {
                if (e2) return callback(e2);
                ajustarMontoAbonadoReservaChinchorro(id, callback);
              });
            };
            syncNueva();
          });
        }
      );
      };

      if (Number(chAnt) === Number(chinchorro_id)) {
        return ejecutarUpdate();
      }
      getChinchorroById(chinchorro_id, (errCh, ch) => {
        if (errCh) return callback(errCh);
        if (!ch) return callback(new Error('Chinchorro no encontrado'));
        const msgEst = mensajeInventarioNoReservable(ch.estado, 'chinchorro');
        if (msgEst) return callback(new Error(msgEst));
        ejecutarUpdate();
      });
    };

    if (String(curr.estado) === 'Activa') {
      db.all(
        `
          SELECT * FROM reservas_chinchorros
          WHERE chinchorro_id = ?
          AND estado = 'Activa'
          AND id != ?
          AND fecha_ingreso < ?
          AND fecha_salida > ?
        `,
        [chinchorro_id, id, fecha_salida, fecha_ingreso],
        (ovErr, rows) => {
          if (ovErr) {
            return callback(ovErr);
          }
          if (rows && rows.length > 0) {
            return callback(new Error('El chinchorro ya está reservado en esas fechas'));
          }
          aplicarActualizacion();
        }
      );
    } else {
      aplicarActualizacion();
    }
  });
}

function updateReservaChinchorroEstado(id, estado, callback) {
  db.run('UPDATE reservas_chinchorros SET estado = ? WHERE id = ?', [estado, id], function(err) {
    if (err) {
      return callback(err);
    }
    db.get('SELECT chinchorro_id FROM reservas_chinchorros WHERE id = ?', [id], (err2, row) => {
      if (err2) return callback(err2);
      if (!row) return callback(null);
      sincronizarEstadoChinchorroConReservas(row.chinchorro_id, (syncErr) => callback(syncErr || null));
    });
  });
}

function deleteReservaChinchorro(id, callback) {
  db.get("SELECT chinchorro_id FROM reservas_chinchorros WHERE id = ?", [id], (err, row) => {
    if (err) {
      callback(err);
    } else {
      db.run("DELETE FROM reservas_chinchorros WHERE id = ?", [id], function(err) {
        if (!err && row) {
          sincronizarEstadoChinchorroConReservas(row.chinchorro_id, () => {});
        }
        callback(err);
      });
    }
  });
}

/** Recalcula estado de todas las habitaciones y chinchorros según reservas activas. */
function sincronizarTodosEstadosInventario(callback) {
  db.all('SELECT id FROM habitaciones', [], (e1, habs) => {
    if (e1) return callback(e1);
    const listaH = habs || [];
    let i = 0;
    const syncHab = () => {
      if (i >= listaH.length) {
        db.all('SELECT id FROM chinchorros', [], (e2, chs) => {
          if (e2) return callback(e2);
          const listaC = chs || [];
          let j = 0;
          const syncCh = () => {
            if (j >= listaC.length) return callback(null);
            sincronizarEstadoChinchorroConReservas(listaC[j].id, () => {
              j += 1;
              syncCh();
            });
          };
          syncCh();
        });
        return;
      }
      sincronizarEstadoHabitacionConReservas(listaH[i].id, () => {
        i += 1;
        syncHab();
      });
    };
    syncHab();
  });
}

// Funciones de Autenticación
function normalizarRolUsuario(rol, username) {
  const r = String(rol || '').trim().toLowerCase();
  if (r === 'administrador') {
    return 'administrador';
  }
  if ((!rol || String(rol).trim() === '') && String(username || '').trim().toLowerCase() === 'admin') {
    return 'administrador';
  }
  return 'operador';
}

/** Solo activo=0 desactiva; NULL u otros valores se tratan como activo (cuentas antiguas). */
function usuarioEstaActivo(activo) {
  return !(activo === 0 || activo === '0' || activo === false);
}

function getUserByUsername(username, callback) {
  const u = String(username || '').trim();
  if (!u) {
    return setImmediate(() => callback(null, null));
  }
  db.get(
    `SELECT * FROM usuarios WHERE LOWER(TRIM(COALESCE(username,''))) = LOWER(?)`,
    [u],
    callback
  );
}

function usernameExistsIgnoreCase(username, exceptId, callback) {
  const u = String(username || '').trim();
  if (!u) {
    return setImmediate(() => callback(null, false));
  }
  const params = [u];
  let sql =
    `SELECT id FROM usuarios WHERE LOWER(TRIM(COALESCE(username,''))) = LOWER(?)`;
  if (exceptId != null) {
    sql += ' AND id != ?';
    params.push(exceptId);
  }
  db.get(sql, params, (err, row) => callback(err, !!row));
}

function getUserById(id, callback) {
  db.get("SELECT * FROM usuarios WHERE id = ?", [id], callback);
}

function getAllUsers(callback) {
  db.all(
    `SELECT id, username, nombre, email, activo, rol, fecha_creacion, ultimo_acceso
     FROM usuarios ORDER BY LOWER(username)`,
    callback
  );
}

function updateLastAccess(userId, callback) {
  db.run("UPDATE usuarios SET ultimo_acceso = CURRENT_TIMESTAMP WHERE id = ?", [userId], callback);
}

function createUser(username, password, nombre, email, rol, callback) {
  const r = rol === 'administrador' ? 'administrador' : 'operador';
  const login = String(username || '').trim();
  if (!login) {
    return setImmediate(() => callback(new Error('El usuario no puede estar vacío')));
  }
  usernameExistsIgnoreCase(login, null, (errExists, taken) => {
    if (errExists) {
      return callback(errExists);
    }
    if (taken) {
      return callback(new Error('Ya existe un usuario con ese nombre (sin distinguir mayúsculas)'));
    }
    hashPasswordLogin(password, (err, hash, sha) => {
      if (err) {
        callback(err);
      } else {
        db.run(
          "INSERT INTO usuarios (username, password, password_sha256_ci, nombre, email, rol, activo) VALUES (?, ?, ?, ?, ?, ?, 1)",
          [login, hash, sha, nombre || '', email || '', r],
          function(err) {
            if (err) {
              callback(err);
            } else {
              callback(null, { id: this.lastID, username: login, nombre, email, rol: r, activo: 1 });
            }
          }
        );
      }
    });
  });
}

function updateUserDatos(id, nombre, email, rol, callback) {
  const r = rol === 'administrador' ? 'administrador' : 'operador';
  db.run(
    "UPDATE usuarios SET nombre = ?, email = ?, rol = ? WHERE id = ?",
    [nombre || '', email || '', r, id],
    callback
  );
}

/** Normaliza la clave para comparación/guardado sin distinguir mayúsculas (todos los roles). */
function normalizarPasswordLogin(password) {
  return String(password || '').toLocaleLowerCase('es');
}

function sha256PasswordCi(password) {
  return crypto
    .createHash('sha256')
    .update(normalizarPasswordLogin(password))
    .digest('hex');
}

function variantesMayusculasClave(str, maxBitsLetras = 8) {
  const s = String(str || '');
  const folded = normalizarPasswordLogin(s);
  const upper = s.toLocaleUpperCase('es');
  const indices = [];
  for (let i = 0; i < s.length; i++) {
    if (/[a-zA-Z]/.test(s[i])) indices.push(i);
  }
  if (!indices.length || indices.length > maxBitsLetras) {
    return [...new Set([s, folded, upper])];
  }
  const chars = s.split('');
  const variants = new Set();
  const total = 1 << indices.length;
  for (let mask = 0; mask < total; mask++) {
    const copy = chars.slice();
    indices.forEach((idx, bit) => {
      const ch = copy[idx];
      copy[idx] = (mask >> bit) & 1 ? ch.toUpperCase() : ch.toLowerCase();
    });
    variants.add(copy.join(''));
  }
  variants.add(folded);
  variants.add(upper);
  return [...variants];
}

function hashPasswordLogin(password, callback) {
  const bcrypt = require('bcrypt');
  const folded = normalizarPasswordLogin(password);
  const sha = sha256PasswordCi(password);
  bcrypt.hash(folded, 10, (err, hash) => {
    callback(err, hash, sha);
  });
}

function updateUserPasswordById(id, newPassword, callback) {
  hashPasswordLogin(newPassword, (err, hash, sha) => {
    if (err) {
      callback(err);
    } else {
      db.run(
        'UPDATE usuarios SET password = ?, password_sha256_ci = ? WHERE id = ?',
        [hash, sha, id],
        callback
      );
    }
  });
}

function setUserActivo(id, activo, callback) {
  const v = activo ? 1 : 0;
  db.run("UPDATE usuarios SET activo = ? WHERE id = ?", [v, id], callback);
}

/** Cuenta administradores activos distintos de exceptId (para no dejar el sistema sin admin). */
function countAdminsActiveExcept(exceptId, callback) {
  db.get(
    `SELECT COUNT(*) as c FROM usuarios WHERE rol = 'administrador' AND activo = 1 AND id != ?`,
    [exceptId],
    callback
  );
}

function verifyPassword(password, hash, passwordShaCi, callback) {
  if (typeof passwordShaCi === 'function') {
    callback = passwordShaCi;
    passwordShaCi = null;
  }
  const raw = String(password || '');
  if (!hash) {
    return callback(null, false);
  }
  if (passwordShaCi && sha256PasswordCi(raw) === passwordShaCi) {
    return callback(null, true);
  }

  const bcrypt = require('bcrypt');
  const variantes = variantesMayusculasClave(raw);
  let i = 0;
  const probar = () => {
    if (i >= variantes.length) {
      return callback(null, false);
    }
    const intento = variantes[i++];
    bcrypt.compare(intento, hash, (err, ok) => {
      if (err) {
        return callback(err);
      }
      if (ok) {
        return callback(null, true);
      }
      probar();
    });
  };
  probar();
}

/** Guarda la clave normalizada para que futuros ingresos no distingan mayúsculas. */
function syncPasswordHashNormalized(userId, password, callback) {
  hashPasswordLogin(password, (err, hash, sha) => {
    if (err) {
      return callback(err);
    }
    db.run(
      'UPDATE usuarios SET password = ?, password_sha256_ci = ? WHERE id = ?',
      [hash, sha, userId],
      callback
    );
  });
}

function candidatosMigracionClaveUsuario(user) {
  const u = String(user.username || '').trim();
  if (!u) return [];
  const folded = normalizarPasswordLogin(u);
  const lista = [u, folded, u.toUpperCase()];
  if (folded === 'admin') {
    lista.push('admin123');
  }
  return [...new Set(lista)];
}

/** Intenta normalizar el hash si la clave coincide con candidatos conocidos (arranque). */
function intentarMigrarHashClaveUsuario(user, callback) {
  const candidatos = candidatosMigracionClaveUsuario(user);
  if (!candidatos.length) {
    return callback();
  }
  let i = 0;
  const siguiente = () => {
    if (i >= candidatos.length) {
      return callback();
    }
    const clave = candidatos[i++];
    verifyPassword(clave, user.password, user.password_sha256_ci, (err, ok) => {
      if (err) {
        return callback(err);
      }
      if (ok) {
        return syncPasswordHashNormalized(user.id, clave, callback);
      }
      siguiente();
    });
  };
  siguiente();
}

/** Migración única: administradores, operadores y cuentas futuras (al crear o al ingresar). */
function migrarContrasenasSinMayusculasTodosRoles(callback) {
  db.run(
    `CREATE TABLE IF NOT EXISTS migraciones_app (
      clave TEXT PRIMARY KEY,
      aplicada_en DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    (errCreate) => {
      if (errCreate) {
        return callback(errCreate);
      }
      db.get(
        `SELECT 1 AS ok FROM migraciones_app WHERE clave = 'pwd_insensitive_admin_operador_v1'`,
        (err, row) => {
          if (err) {
            return callback(err);
          }
          if (row) {
            return callback();
          }
          db.all(`SELECT id, username, password, rol FROM usuarios`, (e2, usuarios) => {
            if (e2) {
              return callback(e2);
            }
            const lista = usuarios || [];
            if (!lista.length) {
              return marcarMigracionClaves(callback);
            }
            let pend = lista.length;
            const fin = (e) => {
              if (e) {
                console.warn('Migración clave usuario:', e.message || e);
              }
              pend -= 1;
              if (pend <= 0) {
                marcarMigracionClaves(callback);
              }
            };
            lista.forEach((u) => {
              intentarMigrarHashClaveUsuario(u, (e) => fin(e));
            });
          });
        }
      );
    }
  );
}

function marcarMigracionClaves(callback) {
  db.run(
    `INSERT OR IGNORE INTO migraciones_app (clave) VALUES ('pwd_insensitive_admin_operador_v1')`,
    (e) => {
      if (!e) {
        console.log(
          'Clave sin mayúsculas activa para administradores, operadores y usuarios nuevos.'
        );
      }
      callback(e);
    }
  );
}

module.exports = {
  db,
  getDatabaseInfo,
  pingDatabase,
  getHotel,
  ensureHotelRow,
  updateHotelNombre,
  updateHotelVistas,
  updateHotelApariencia,
  updateHotelLogoUrl,
  getAllHabitaciones,
  getHabitacionById,
  createHabitacion,
  updateHabitacionDatos,
  updateHabitacionEstado,
  habitacionTieneReservaActivaHoy,
  deleteHabitacion,
  getCamasByHabitacion,
  createCama,
  deleteCama,
  getAllHuespedes,
  getHuespedById,
  createHuesped,
  updateHuesped,
  deleteHuesped,
  getAllReservas,
  getReservaById,
  updateReservaDatos,
  createReserva,
  registrarAbonoReserva,
  totalizarReserva,
  updateReservaEstado,
  sincronizarEstadoHabitacionConReservas,
  sincronizarTodosEstadosInventario,
  deleteReserva,
  getUserByUsername,
  usernameExistsIgnoreCase,
  getUserById,
  normalizarRolUsuario,
  usuarioEstaActivo,
  getAllUsers,
  updateLastAccess,
  createUser,
  updateUserDatos,
  updateUserPasswordById,
  setUserActivo,
  countAdminsActiveExcept,
  verifyPassword,
  syncPasswordHashNormalized,
  normalizarPasswordLogin,
  getAllChinchorros,
  getChinchorroById,
  chinchorroTieneReservaActivaHoy,
  createChinchorro,
  updateChinchorroDatos,
  updateChinchorroEstado,
  deleteChinchorro,
  getAllReservasChinchorros,
  createReservaChinchorro,
  registrarAbonoReservaChinchorro,
  totalizarReservaChinchorro,
  updateReservaChinchorroDatos,
  updateReservaChinchorroEstado,
  deleteReservaChinchorro
};
