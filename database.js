const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : null;
const DB_PATH = DATA_DIR ? path.join(DATA_DIR, 'hotel.db') : path.join(__dirname, 'hotel.db');

if (DATA_DIR && !fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Crear conexión a la base de datos
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error al conectar con la base de datos:', err.message);
  } else {
    console.log('Conectado a la base de datos SQLite');
    initDatabase();
  }
});

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
      'ALTER TABLE hotel ADD COLUMN fondo_imagen_url TEXT'
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
      numero TEXT NOT NULL UNIQUE,
      tipo TEXT,
      estado TEXT NOT NULL DEFAULT 'Disponible',
      fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
      if (err) {
        console.error('Error al crear tabla habitaciones:', err);
      } else {
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
      documento TEXT,
      fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
      if (err) console.error('Error al crear tabla huespedes:', err);
    });

    // Tabla de reservas
    db.run(`CREATE TABLE IF NOT EXISTS reservas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      habitacion_id INTEGER NOT NULL,
      huesped_id INTEGER NOT NULL,
      fecha_ingreso DATE NOT NULL,
      fecha_salida DATE NOT NULL,
      estado TEXT NOT NULL DEFAULT 'Activa',
      fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (habitacion_id) REFERENCES habitaciones(id) ON DELETE CASCADE,
      FOREIGN KEY (huesped_id) REFERENCES huespedes(id) ON DELETE CASCADE
    )`, (err) => {
      if (err) console.error('Error al crear tabla reservas:', err);
    });

    // Chinchorros (alquiler)
    db.run(`CREATE TABLE IF NOT EXISTS chinchorros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT NOT NULL UNIQUE,
      zona TEXT,
      estado TEXT NOT NULL DEFAULT 'Disponible',
      fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
      if (err) {
        console.error('Error al crear tabla chinchorros:', err);
      } else {
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
      fecha_ingreso DATE NOT NULL,
      fecha_salida DATE NOT NULL,
      estado TEXT NOT NULL DEFAULT 'Activa',
      fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chinchorro_id) REFERENCES chinchorros(id) ON DELETE CASCADE,
      FOREIGN KEY (huesped_id) REFERENCES huespedes(id) ON DELETE CASCADE
    )`, (err) => {
      if (err) console.error('Error al crear tabla reservas_chinchorros:', err);
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
            const bcrypt = require('bcrypt');
            const defaultPassword = 'admin123';
            bcrypt.hash(defaultPassword, 10, (err, hash) => {
              if (!err) {
                db.run(
                  "INSERT INTO usuarios (username, password, nombre, rol) VALUES (?, ?, ?, ?)",
                  ['admin', hash, 'Administrador', 'administrador'],
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
    const cols = ['color_primario', 'color_secundario', 'color_acento', 'color_titulo', 'fondo_imagen_url'];
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

function createHabitacion(numero, tipo, precio_diario, callback) {
  const p = precio_diario == null || precio_diario === '' ? 0 : Number(precio_diario);
  const precio = Number.isFinite(p) && p >= 0 ? p : 0;
  db.run(
    "INSERT INTO habitaciones (numero, tipo, estado, precio_diario) VALUES (?, ?, 'Disponible', ?)",
    [numero, tipo, precio],
    function(err) {
      if (err) {
        callback(err);
      } else {
        callback(null, { id: this.lastID, numero, tipo, estado: 'Disponible', precio_diario: precio });
      }
    }
  );
}

function updateHabitacionDatos(id, numero, tipo, precio_diario, callback) {
  const p = precio_diario == null || precio_diario === '' ? 0 : Number(precio_diario);
  const precio = Number.isFinite(p) && p >= 0 ? p : 0;
  db.run(
    'UPDATE habitaciones SET numero = ?, tipo = ?, precio_diario = ? WHERE id = ?',
    [numero, tipo || 'Estándar', precio, id],
    callback
  );
}

function updateHabitacionEstado(id, estado, callback) {
  db.run("UPDATE habitaciones SET estado = ? WHERE id = ?", [estado, id], callback);
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

function createHuesped(nombre, apellido, email, telefono, documento, callback) {
  db.run("INSERT INTO huespedes (nombre, apellido, email, telefono, documento) VALUES (?, ?, ?, ?, ?)", 
    [nombre, apellido, email, telefono, documento], function(err) {
    if (err) {
      callback(err);
    } else {
      callback(null, { 
        id: this.lastID, 
        nombre, 
        apellido, 
        email, 
        telefono, 
        documento 
      });
    }
  });
}

function updateHuesped(id, nombre, apellido, email, telefono, documento, callback) {
  db.run(
    "UPDATE huespedes SET nombre = ?, apellido = ?, email = ?, telefono = ?, documento = ? WHERE id = ?",
    [nombre, apellido, email, telefono, documento, id],
    function(err) {
      if (err) {
        callback(err);
      } else {
        callback(null, { id, nombre, apellido, email, telefono, documento });
      }
    }
  );
}

function deleteHuesped(id, callback) {
  db.run("DELETE FROM huespedes WHERE id = ?", [id], callback);
}

// Funciones para Reservas
function getAllReservas(callback) {
  db.all(`
    SELECT r.*,
           h.numero as habitacion_numero,
           h.precio_diario as habitacion_precio_diario,
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

/** Ajusta ocupación de habitación según reservas activas que incluyan la fecha actual. */
function sincronizarEstadoHabitacionConReservas(habitacion_id, callback) {
  db.all(
    `
      SELECT COUNT(*) as count FROM reservas 
      WHERE habitacion_id = ? 
      AND estado = 'Activa'
      AND DATE('now') BETWEEN fecha_ingreso AND fecha_salida
    `,
    [habitacion_id],
    (err, rows) => {
      if (err) {
        callback(err);
        return;
      }
      const ocupada = rows && rows[0] && rows[0].count > 0;
      updateHabitacionEstado(habitacion_id, ocupada ? 'Ocupada' : 'Disponible', (e2) => callback(e2));
    }
  );
}

function updateReservaDatos(id, habitacion_id, huesped_id, fecha_ingreso, fecha_salida, callback) {
  getReservaById(id, (err, curr) => {
    if (err) {
      return callback(err);
    }
    if (!curr) {
      return callback(new Error('Reserva no encontrada'));
    }
    const roomAnt = curr.habitacion_id;

    const aplicarActualizacion = () => {
      db.run(
        'UPDATE reservas SET habitacion_id = ?, huesped_id = ?, fecha_ingreso = ?, fecha_salida = ? WHERE id = ?',
        [habitacion_id, huesped_id, fecha_ingreso, fecha_salida, id],
        (runErr) => {
          if (runErr) {
            callback(runErr);
            return;
          }
          sincronizarEstadoHabitacionConReservas(roomAnt, (e1) => {
            if (e1) return callback(e1);
            if (Number(roomAnt) === Number(habitacion_id)) {
              return callback(null);
            }
            sincronizarEstadoHabitacionConReservas(habitacion_id, (e2) => callback(e2 || null));
          });
        }
      );
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

function createReserva(habitacion_id, huesped_id, fecha_ingreso, fecha_salida, callback) {
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
      db.run("INSERT INTO reservas (habitacion_id, huesped_id, fecha_ingreso, fecha_salida) VALUES (?, ?, ?, ?)", 
        [habitacion_id, huesped_id, fecha_ingreso, fecha_salida], function(err) {
        if (err) {
          callback(err);
        } else {
          // Actualizar estado de la habitación
          updateHabitacionEstado(habitacion_id, 'Ocupada', () => {});
          callback(null, { 
            id: this.lastID, 
            habitacion_id, 
            huesped_id, 
            fecha_ingreso, 
            fecha_salida,
            estado: 'Activa'
          });
        }
      });
    }
  });
}

function updateReservaEstado(id, estado, callback) {
  db.run("UPDATE reservas SET estado = ? WHERE id = ?", [estado, id], function(err) {
    if (!err && (estado === 'Cancelada' || estado === 'Finalizada')) {
      db.get("SELECT habitacion_id FROM reservas WHERE id = ?", [id], (err, row) => {
        if (!err && row) {
          db.all(
            `
            SELECT COUNT(*) as count FROM reservas 
            WHERE habitacion_id = ? 
            AND estado = 'Activa'
            AND DATE('now') BETWEEN fecha_ingreso AND fecha_salida
          `,
            [row.habitacion_id],
            (err2, rows) => {
              if (!err2 && rows[0].count === 0) {
                updateHabitacionEstado(row.habitacion_id, 'Disponible', () => {});
              }
            }
          );
        }
      });
    }
    callback(err);
  });
}

function deleteReserva(id, callback) {
  db.get("SELECT habitacion_id FROM reservas WHERE id = ?", [id], (err, row) => {
    if (err) {
      callback(err);
    } else {
      db.run("DELETE FROM reservas WHERE id = ?", [id], function(err) {
        if (!err && row) {
          // Verificar si hay otras reservas activas
          db.all(`
            SELECT COUNT(*) as count FROM reservas 
            WHERE habitacion_id = ? 
            AND estado = 'Activa'
            AND DATE('now') BETWEEN fecha_ingreso AND fecha_salida
          `, [row.habitacion_id], (err, rows) => {
            if (!err && rows[0].count === 0) {
              updateHabitacionEstado(row.habitacion_id, 'Disponible', () => {});
            }
          });
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

function createChinchorro(codigo, zona, precio_diario, callback) {
  const p = precio_diario == null || precio_diario === '' ? 0 : Number(precio_diario);
  const precio = Number.isFinite(p) && p >= 0 ? p : 0;
  db.run(
    "INSERT INTO chinchorros (codigo, zona, estado, precio_diario) VALUES (?, ?, 'Disponible', ?)",
    [codigo, zona || null, precio],
    function(err) {
      if (err) {
        callback(err);
      } else {
        callback(null, {
          id: this.lastID,
          codigo,
          zona: zona || null,
          estado: 'Disponible',
          precio_diario: precio
        });
      }
    }
  );
}

function updateChinchorroDatos(id, codigo, zona, precio_diario, callback) {
  const p = precio_diario == null || precio_diario === '' ? 0 : Number(precio_diario);
  const precio = Number.isFinite(p) && p >= 0 ? p : 0;
  db.run(
    'UPDATE chinchorros SET codigo = ?, zona = ?, precio_diario = ? WHERE id = ?',
    [codigo, zona || null, precio, id],
    callback
  );
}

function deleteChinchorro(id, callback) {
  db.run("DELETE FROM chinchorros WHERE id = ?", [id], callback);
}

function getAllReservasChinchorros(callback) {
  db.all(
    `
    SELECT r.*,
           ch.codigo as chinchorro_codigo,
           ch.precio_diario as chinchorro_precio_diario,
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

function createReservaChinchorro(chinchorro_id, huesped_id, fecha_ingreso, fecha_salida, callback) {
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
      db.run(
        "INSERT INTO reservas_chinchorros (chinchorro_id, huesped_id, fecha_ingreso, fecha_salida) VALUES (?, ?, ?, ?)",
        [chinchorro_id, huesped_id, fecha_ingreso, fecha_salida],
        function(err) {
          if (err) {
            callback(err);
          } else {
            updateChinchorroEstado(chinchorro_id, 'Ocupada', () => {});
            callback(null, {
              id: this.lastID,
              chinchorro_id,
              huesped_id,
              fecha_ingreso,
              fecha_salida,
              estado: 'Activa'
            });
          }
        }
      );
    }
  });
}

function getReservaChinchorroById(id, callback) {
  db.get('SELECT * FROM reservas_chinchorros WHERE id = ?', [id], callback);
}

function sincronizarEstadoChinchorroConReservas(chinchorro_id, callback) {
  db.all(
    `
      SELECT COUNT(*) as count FROM reservas_chinchorros
      WHERE chinchorro_id = ?
      AND estado = 'Activa'
      AND DATE('now') BETWEEN fecha_ingreso AND fecha_salida
    `,
    [chinchorro_id],
    (err, rows) => {
      if (err) {
        callback(err);
        return;
      }
      const ocupada = rows && rows[0] && rows[0].count > 0;
      updateChinchorroEstado(chinchorro_id, ocupada ? 'Ocupada' : 'Disponible', (e2) => callback(e2));
    }
  );
}

function updateReservaChinchorroDatos(id, chinchorro_id, huesped_id, fecha_ingreso, fecha_salida, callback) {
  getReservaChinchorroById(id, (err, curr) => {
    if (err) {
      return callback(err);
    }
    if (!curr) {
      return callback(new Error('Reserva no encontrada'));
    }
    const chAnt = curr.chinchorro_id;

    const aplicarActualizacion = () => {
      db.run(
        'UPDATE reservas_chinchorros SET chinchorro_id = ?, huesped_id = ?, fecha_ingreso = ?, fecha_salida = ? WHERE id = ?',
        [chinchorro_id, huesped_id, fecha_ingreso, fecha_salida, id],
        (runErr) => {
          if (runErr) {
            callback(runErr);
            return;
          }
          sincronizarEstadoChinchorroConReservas(chAnt, (e1) => {
            if (e1) return callback(e1);
            if (Number(chAnt) === Number(chinchorro_id)) {
              return callback(null);
            }
            sincronizarEstadoChinchorroConReservas(chinchorro_id, (e2) => callback(e2 || null));
          });
        }
      );
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
  db.run("UPDATE reservas_chinchorros SET estado = ? WHERE id = ?", [estado, id], function(err) {
    if (!err && (estado === 'Cancelada' || estado === 'Finalizada')) {
      db.get("SELECT chinchorro_id FROM reservas_chinchorros WHERE id = ?", [id], (err, row) => {
        if (!err && row) {
          db.all(
            `
            SELECT COUNT(*) as count FROM reservas_chinchorros
            WHERE chinchorro_id = ?
            AND estado = 'Activa'
            AND DATE('now') BETWEEN fecha_ingreso AND fecha_salida
          `,
            [row.chinchorro_id],
            (err2, rows) => {
              if (!err2 && rows[0].count === 0) {
                updateChinchorroEstado(row.chinchorro_id, 'Disponible', () => {});
              }
            }
          );
        }
      });
    }
    callback(err);
  });
}

function deleteReservaChinchorro(id, callback) {
  db.get("SELECT chinchorro_id FROM reservas_chinchorros WHERE id = ?", [id], (err, row) => {
    if (err) {
      callback(err);
    } else {
      db.run("DELETE FROM reservas_chinchorros WHERE id = ?", [id], function(err) {
        if (!err && row) {
          db.all(`
            SELECT COUNT(*) as count FROM reservas_chinchorros
            WHERE chinchorro_id = ?
            AND estado = 'Activa'
            AND DATE('now') BETWEEN fecha_ingreso AND fecha_salida
          `, [row.chinchorro_id], (err, rows) => {
            if (!err && rows[0].count === 0) {
              updateChinchorroEstado(row.chinchorro_id, 'Disponible', () => {});
            }
          });
        }
        callback(err);
      });
    }
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
    const bcrypt = require('bcrypt');
    bcrypt.hash(password, 10, (err, hash) => {
      if (err) {
        callback(err);
      } else {
        db.run(
          "INSERT INTO usuarios (username, password, nombre, email, rol, activo) VALUES (?, ?, ?, ?, ?, 1)",
          [login, hash, nombre || '', email || '', r],
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

function updateUserPasswordById(id, newPassword, callback) {
  const bcrypt = require('bcrypt');
  bcrypt.hash(newPassword, 10, (err, hash) => {
    if (err) {
      callback(err);
    } else {
      db.run("UPDATE usuarios SET password = ? WHERE id = ?", [hash, id], callback);
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

function verifyPassword(password, hash, callback) {
  const bcrypt = require('bcrypt');
  bcrypt.compare(password, hash, callback);
}

module.exports = {
  db,
  getHotel,
  ensureHotelRow,
  updateHotelNombre,
  updateHotelVistas,
  updateHotelApariencia,
  getAllHabitaciones,
  getHabitacionById,
  createHabitacion,
  updateHabitacionDatos,
  updateHabitacionEstado,
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
  updateReservaEstado,
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
  getAllChinchorros,
  createChinchorro,
  updateChinchorroDatos,
  updateChinchorroEstado,
  deleteChinchorro,
  getAllReservasChinchorros,
  createReservaChinchorro,
  updateReservaChinchorroDatos,
  updateReservaChinchorroEstado,
  deleteReservaChinchorro
};
