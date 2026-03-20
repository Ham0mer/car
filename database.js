const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'data', 'app.db');

// 确保数据文件夹存在
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('数据库连接错误:', err.message);
  } else {
    console.log('已连接到本地 SQLite 数据库:', dbPath);
  }
});

// 启用外键支持
db.run('PRAGMA foreign_keys = ON');

let initPromise;

function initDatabase() {
  if (initPromise) {
    return initPromise;
  }

  initPromise = new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS vehicles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          current_mileage REAL NOT NULL,
          password TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS refuel_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          vehicle_id INTEGER NOT NULL,
          liters REAL,
          price REAL,
          mileage REAL NOT NULL,
          refuel_date TEXT DEFAULT CURRENT_TIMESTAMP,
          image_path TEXT,
          FOREIGN KEY(vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS extra_expenses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          vehicle_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          amount REAL NOT NULL,
          expense_date TEXT DEFAULT CURRENT_TIMESTAMP,
          image_path TEXT,
          FOREIGN KEY(vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS maintenance_settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          vehicle_id INTEGER NOT NULL,
          interval_km REAL NOT NULL,
          description TEXT,
          UNIQUE(vehicle_id, interval_km),
          FOREIGN KEY(vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS maintenance_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          vehicle_id INTEGER NOT NULL,
          maintenance_date TEXT DEFAULT CURRENT_TIMESTAMP,
          mileage REAL NOT NULL,
          description TEXT,
          amount REAL NOT NULL,
          image_path TEXT,
          FOREIGN KEY(vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
        )
      `, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  return initPromise;
}

function run(operation, callback) {
  initDatabase().then(() => {
    operation((err, result) => {
      callback(err, result);
    });
  }).catch((err) => {
    callback(err);
  });
}

// 获取所有车辆
function getAllVehicles(callback) {
  run((next) => {
    db.all('SELECT * FROM vehicles ORDER BY created_at DESC', (err, rows) => {
      next(err, rows || []);
    });
  }, callback);
}

// 添加车辆
function addVehicle(name, currentMileage, callback) {
  run((next) => {
    db.run(
      'INSERT INTO vehicles (name, current_mileage) VALUES (?, ?)',
      [name, currentMileage],
      function(err) {
        if (err) {
          next(err);
          return;
        }
        const vehicleId = this.lastID;

        db.run(
          'INSERT INTO refuel_records (vehicle_id, liters, price, mileage, refuel_date) VALUES (?, ?, ?, ?, ?)',
          [vehicleId, null, null, currentMileage, new Date().toISOString()],
          (err) => {
            next(err, vehicleId);
          }
        );
      }
    );
  }, callback);
}

// 更新车辆里程
function updateVehicleMileage(vehicleId, mileage, callback) {
  run((next) => {
    db.run('UPDATE vehicles SET current_mileage = ? WHERE id = ?', [mileage, vehicleId], (err) => {
      next(err);
    });
  }, callback);
}

// 设置/更新车辆密码
function updateVehiclePassword(vehicleId, password, callback) {
  run((next) => {
    db.run('UPDATE vehicles SET password = ? WHERE id = ?', [password, vehicleId], (err) => {
      next(err);
    });
  }, callback);
}

// 删除车辆
function deleteVehicle(vehicleId, callback) {
  run((next) => {
    db.run('DELETE FROM vehicles WHERE id = ?', [vehicleId], (err) => {
      next(err);
    });
  }, callback);
}

// 添加加油记录
function addRefuelRecord(vehicleId, liters, price, mileage, refuelDate, imagePath, callback) {
  const date = refuelDate || new Date().toISOString();
  const litersValue = (liters === null || liters === undefined || liters === '' || liters === 0) ? null : liters;
  const priceValue = (price === null || price === undefined || price === '' || price === 0) ? null : price;

  run((next) => {
    db.run(
      'INSERT INTO refuel_records (vehicle_id, liters, price, mileage, refuel_date, image_path) VALUES (?, ?, ?, ?, ?, ?)',
      [vehicleId, litersValue, priceValue, mileage, date, imagePath || null],
      function(err) {
        if (err) {
          next(err);
          return;
        }
        const recordId = this.lastID;

        db.run('UPDATE vehicles SET current_mileage = ? WHERE id = ?', [mileage, vehicleId], (err) => {
          next(err, recordId);
        });
      }
    );
  }, callback);
}

// 更新加油记录
function updateRefuelRecord(recordId, liters, price, mileage, refuelDate, imagePath, callback) {
  run((next) => {
    db.run(
      'UPDATE refuel_records SET liters = ?, price = ?, mileage = ?, refuel_date = ?, image_path = ? WHERE id = ?',
      [liters, price, mileage, refuelDate, imagePath || null, recordId],
      (err) => {
        if (err) {
          next(err);
          return;
        }

        db.get('SELECT vehicle_id FROM refuel_records WHERE id = ?', [recordId], (err, row) => {
          if (err || !row) {
            next(err);
            return;
          }

          const vehicleId = row.vehicle_id;
          db.get('SELECT COALESCE(MAX(mileage), ?) as max_mileage FROM refuel_records WHERE vehicle_id = ?', [mileage, vehicleId], (err, result) => {
            if (err) {
              next(err);
              return;
            }

            db.run('UPDATE vehicles SET current_mileage = ? WHERE id = ?', [result.max_mileage, vehicleId], (err) => {
              next(err);
            });
          });
        });
      }
    );
  }, callback);
}

// 删除加油记录
function deleteRefuelRecord(recordId, callback) {
  run((next) => {
    db.get('SELECT vehicle_id FROM refuel_records WHERE id = ?', [recordId], (err, row) => {
      if (err) {
        next(err);
        return;
      }

      db.run('DELETE FROM refuel_records WHERE id = ?', [recordId], (err) => {
        if (err) {
          next(err);
          return;
        }

        if (!row) {
          next(null);
          return;
        }

        const vehicleId = row.vehicle_id;
        db.get('SELECT COALESCE(MAX(mileage), 0) as max_mileage FROM refuel_records WHERE vehicle_id = ?', [vehicleId], (err, result) => {
          if (err) {
            next(err);
            return;
          }

          db.run('UPDATE vehicles SET current_mileage = ? WHERE id = ?', [result.max_mileage, vehicleId], (err) => {
            next(err);
          });
        });
      });
    });
  }, callback);
}

// 获取车辆的加油记录
function getRefuelRecords(vehicleId, callback) {
  run((next) => {
    db.all('SELECT * FROM refuel_records WHERE vehicle_id = ? ORDER BY refuel_date DESC', [vehicleId], (err, rows) => {
      next(err, rows || []);
    });
  }, callback);
}

// 获取所有车辆的加油记录（用于统计）
function getAllRefuelRecords(callback) {
  run((next) => {
    db.all(`SELECT r.*, v.name as vehicle_name FROM refuel_records r JOIN vehicles v ON r.vehicle_id = v.id ORDER BY r.refuel_date DESC`, (err, rows) => {
      next(err, rows || []);
    });
  }, callback);
}

// 获取车辆统计信息
function getVehicleStats(vehicleId, callback) {
  run((next) => {
    db.get(
      `SELECT
        COUNT(*) as total_refuels,
        COALESCE(SUM(liters), 0) as total_liters,
        COALESCE(SUM(price), 0) as total_cost,
        AVG(CASE WHEN liters > 0 THEN price / liters END) as avg_price_per_liter,
        COALESCE(MIN(mileage), 0) as min_mileage,
        COALESCE(MAX(mileage), 0) as max_mileage,
        COALESCE(MAX(mileage), 0) - COALESCE(MIN(mileage), 0) as total_distance
       FROM refuel_records
       WHERE vehicle_id = ?`,
      [vehicleId],
      (err, stats) => {
        if (err) {
          next(err);
          return;
        }

        const result = stats || {
          total_refuels: 0,
          total_liters: 0,
          total_cost: 0,
          avg_price_per_liter: null,
          min_mileage: 0,
          max_mileage: 0,
          total_distance: 0
        };

        if (result.total_refuels >= 2) {
          db.all(
            `SELECT mileage, liters FROM refuel_records WHERE vehicle_id = ? ORDER BY mileage ASC`,
            [vehicleId],
            (err, records) => {
              if (err) {
                next(err);
                return;
              }

              let totalDistance = 0;
              let totalLiters = 0;

              for (let i = 1; i < records.length; i++) {
                const distance = Number(records[i].mileage) - Number(records[i - 1].mileage);
                totalDistance += distance;
                totalLiters += Number(records[i].liters || 0);
              }

              result.avg_fuel_consumption = totalLiters > 0 && totalDistance > 0
                ? (totalLiters / totalDistance * 100).toFixed(2)
                : 0;

              next(null, result);
            }
          );
        } else {
          result.avg_fuel_consumption = 0;
          next(null, result);
        }
      }
    );
  }, callback);
}

// 获取车辆的额外消费记录
function getExtraExpenses(vehicleId, callback) {
  run((next) => {
    db.all('SELECT * FROM extra_expenses WHERE vehicle_id = ? ORDER BY expense_date DESC', [vehicleId], (err, rows) => {
      next(err, rows || []);
    });
  }, callback);
}

// 添加额外消费记录
function addExtraExpense(vehicleId, title, amount, expenseDate, imagePath, callback) {
  const date = expenseDate || new Date().toISOString();
  run((next) => {
    db.run(
      'INSERT INTO extra_expenses (vehicle_id, title, amount, expense_date, image_path) VALUES (?, ?, ?, ?, ?)',
      [vehicleId, title, amount, date, imagePath || null],
      function(err) {
        next(err, this?.lastID);
      }
    );
  }, callback);
}

// 更新额外消费记录
function updateExtraExpense(expenseId, title, amount, expenseDate, imagePath, callback) {
  run((next) => {
    db.run(
      'UPDATE extra_expenses SET title = ?, amount = ?, expense_date = ?, image_path = ? WHERE id = ?',
      [title, amount, expenseDate, imagePath || null, expenseId],
      (err) => {
        next(err);
      }
    );
  }, callback);
}

// 删除额外消费记录
function deleteExtraExpense(expenseId, callback) {
  run((next) => {
    db.run('DELETE FROM extra_expenses WHERE id = ?', [expenseId], (err) => {
      next(err);
    });
  }, callback);
}

// 获取车辆额外消费统计
function getExtraExpenseStats(vehicleId, callback) {
  run((next) => {
    db.get(
      `SELECT
        COUNT(*) as total_expenses,
        COALESCE(SUM(amount), 0) as total_amount
       FROM extra_expenses
       WHERE vehicle_id = ?`,
      [vehicleId],
      (err, row) => {
        next(err, row || { total_expenses: 0, total_amount: 0 });
      }
    );
  }, callback);
}

// 清空车辆的加油记录
function clearRefuelRecords(vehicleId, callback) {
  run((next) => {
    db.get('SELECT current_mileage FROM vehicles WHERE id = ?', [vehicleId], (err, vehicle) => {
      if (err) {
        next(err);
        return;
      }

      const initialMileage = vehicle ? Number(vehicle.current_mileage) : 0;

      db.run('DELETE FROM refuel_records WHERE vehicle_id = ?', [vehicleId], (err) => {
        if (err) {
          next(err);
          return;
        }

        db.run(
          'INSERT INTO refuel_records (vehicle_id, liters, price, mileage, refuel_date) VALUES (?, ?, ?, ?, ?)',
          [vehicleId, null, null, initialMileage, new Date().toISOString()],
          (err) => {
            if (err) {
              next(err);
              return;
            }

            db.run('UPDATE vehicles SET current_mileage = ? WHERE id = ?', [initialMileage, vehicleId], (err) => {
              next(err);
            });
          }
        );
      });
    });
  }, callback);
}

// 清空车辆的额外消费记录
function clearExtraExpenses(vehicleId, callback) {
  run((next) => {
    db.run('DELETE FROM extra_expenses WHERE vehicle_id = ?', [vehicleId], (err) => {
      next(err);
    });
  }, callback);
}

// 获取车辆的维保设置
function getMaintenanceSettings(vehicleId, callback) {
  run((next) => {
    db.all('SELECT * FROM maintenance_settings WHERE vehicle_id = ? ORDER BY interval_km ASC', [vehicleId], (err, rows) => {
      next(err, rows || []);
    });
  }, callback);
}

// 添加维保设置
function addMaintenanceSetting(vehicleId, intervalKm, description, callback) {
  run((next) => {
    db.run(
      'INSERT OR REPLACE INTO maintenance_settings (vehicle_id, interval_km, description) VALUES (?, ?, ?)',
      [vehicleId, intervalKm, description || null],
      function(err) {
        next(err, this?.lastID);
      }
    );
  }, callback);
}

// 删除维保设置
function deleteMaintenanceSetting(settingId, callback) {
  run((next) => {
    db.run('DELETE FROM maintenance_settings WHERE id = ?', [settingId], (err) => {
      next(err);
    });
  }, callback);
}

// 获取车辆的维保记录
function getMaintenanceRecords(vehicleId, callback) {
  run((next) => {
    db.all('SELECT * FROM maintenance_records WHERE vehicle_id = ? ORDER BY maintenance_date DESC', [vehicleId], (err, rows) => {
      next(err, rows || []);
    });
  }, callback);
}

// 获取最后一次维保记录（按里程数）
function getLastMaintenanceRecord(vehicleId, intervalKm, callback) {
  run((next) => {
    db.get(
      'SELECT * FROM maintenance_records WHERE vehicle_id = ? ORDER BY mileage DESC LIMIT 1',
      [vehicleId],
      (err, row) => {
        next(err, row || null);
      }
    );
  }, callback);
}

// 添加维保记录
function addMaintenanceRecord(vehicleId, mileage, description, amount, maintenanceDate, imagePath, callback) {
  const date = maintenanceDate || new Date().toISOString();
  run((next) => {
    db.run(
      'INSERT INTO maintenance_records (vehicle_id, mileage, description, amount, maintenance_date, image_path) VALUES (?, ?, ?, ?, ?, ?)',
      [vehicleId, mileage, description || null, amount, date, imagePath || null],
      function(err) {
        next(err, this?.lastID);
      }
    );
  }, callback);
}

// 更新维保记录
function updateMaintenanceRecord(recordId, mileage, description, amount, maintenanceDate, imagePath, callback) {
  run((next) => {
    db.run(
      'UPDATE maintenance_records SET mileage = ?, description = ?, amount = ?, maintenance_date = ?, image_path = ? WHERE id = ?',
      [mileage, description, amount, maintenanceDate, imagePath || null, recordId],
      (err) => {
        next(err);
      }
    );
  }, callback);
}

// 删除维保记录
function deleteMaintenanceRecord(recordId, callback) {
  run((next) => {
    db.run('DELETE FROM maintenance_records WHERE id = ?', [recordId], (err) => {
      next(err);
    });
  }, callback);
}

module.exports = {
  db,
  getAllVehicles,
  addVehicle,
  updateVehicleMileage,
  updateVehiclePassword,
  deleteVehicle,
  addRefuelRecord,
  updateRefuelRecord,
  deleteRefuelRecord,
  getRefuelRecords,
  getAllRefuelRecords,
  getVehicleStats,
  getExtraExpenses,
  addExtraExpense,
  updateExtraExpense,
  deleteExtraExpense,
  getExtraExpenseStats,
  clearRefuelRecords,
  clearExtraExpenses,
  getMaintenanceSettings,
  addMaintenanceSetting,
  deleteMaintenanceSetting,
  getMaintenanceRecords,
  getLastMaintenanceRecord,
  addMaintenanceRecord,
  updateMaintenanceRecord,
  deleteMaintenanceRecord
};
