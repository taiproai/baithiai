const express = require('express');
const mysql = require('mysql');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');

// Kết nối MySQL đã cập nhật
const db = mysql.createConnection({
    host: 'hera.dotvndns.com',
    user: 'shopcova6979_baiduthi',
    password: 'theyoungplus@123',
    database: 'shopcova6979_baiduthi'
});

db.connect(err => {
    if (err) console.error('Lỗi MySQL:', err);
    else {
        console.log('Đã kết nối MySQL thành công.');
        db.query("ALTER TABLE users ADD COLUMN department VARCHAR(50) NULL", () => {});
        db.query("INSERT IGNORE INTO assets (qa_code, name, type, room, status) VALUES ('GLOBAL', 'Kênh Trao đổi Chung', 'Hệ thống', 'Hệ thống', 'Sẵn sàng')", () => {});
    }
});

// --- SOCKET.IO REALTIME CHAT ---
io.on("connection", (socket) => {
    socket.on("sendMessage", (data) => {
        const { qa_code, sender, role, message } = data;
        db.query(
            "INSERT INTO messages (qa_code, sender, role, message) VALUES (?, ?, ?, ?)",
            [qa_code, sender, role, message],
            (err) => {
                if (err) console.error("Lỗi lưu tin nhắn:", err);
                else io.emit("receiveMessage", { qa_code, sender, role, message, timestamp: new Date() });
            }
        );
    });
});

app.get('/api/messages/:qa_code', (req, res) => {
    db.query('SELECT * FROM messages WHERE qa_code = ? ORDER BY timestamp ASC', [req.params.qa_code], (err, results) => {
        if (err) console.error("Lỗi lấy tin nhắn:", err);
        res.json(results || []);
    });
});

// View Routes
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));

// API: Đăng nhập
app.post('/api/login', (req, res) => {
    db.query('SELECT * FROM users WHERE username = ? AND password = ?', [req.body.username, req.body.password], (err, results) => {
        if (err) console.error("Lỗi đăng nhập:", err);
        if (results && results.length > 0) res.json({ success: true, user: results[0] });
        else res.json({ success: false, message: 'Sai tài khoản hoặc mật khẩu' });
    });
});

// API: Dashboard thống kê
app.get('/api/dashboard', (req, res) => {
    const { role } = req.query;
    if (role !== 'admin') return res.json({ total: 0, in_use: 0, broken: 0 });
    db.query(`SELECT COUNT(*) as total, SUM(status = 'Đang sử dụng') as in_use, SUM(status = 'Hỏng') as broken FROM assets WHERE qa_code != 'GLOBAL'`, 
    (err, results) => {
        res.json(results ? results[0] : { total: 0, in_use: 0, broken: 0 });
    });
});

// API: Lịch sử 30 ngày
app.get('/api/history', (req, res) => {
    const { role } = req.query;
    if (role !== 'admin') return res.json([]);
    db.query("SELECT * FROM transactions WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 1 MONTH) ORDER BY timestamp DESC", (err, results) => res.json(results || []));
});

// --- API QUẢN LÝ USER ---
app.get('/api/users', (req, res) => {
    const { requester_id, requester_role } = req.query;
    if (requester_role === 'admin') {
        db.query('SELECT id, username, role, department, manager_id FROM users', (err, results) => res.json(results || []));
    } else if (requester_role === 'manager') {
        db.query('SELECT id, username, role, department, manager_id FROM users WHERE id = ? OR manager_id = ?', [requester_id, requester_id], (err, results) => res.json(results || []));
    } else res.json([]);
});

app.post('/api/users', (req, res) => {
    const { username, password, role, department, requester_id, requester_role } = req.body;
    let manager_id = null;
    if (requester_role === 'manager') {
        if (role !== 'staff') return res.json({ success: false, error: 'Tổ trưởng chỉ được thêm nhân viên (staff)!' });
        manager_id = requester_id;
    }
    db.query('INSERT INTO users (username, password, role, department, manager_id) VALUES (?, ?, ?, ?, ?)', [username, password, role, department, manager_id], err => res.json({ success: !err, error: err?.message }));
});
// API: Cập nhật quyền và thông tin User (Dành riêng cho Admin)
app.put('/api/users/:id', (req, res) => {
    const targetId = req.params.id;
    const { role, department, requester_role } = req.body;
    
    // Chỉ Admin mới có quyền thực hiện
    if (requester_role !== 'admin') {
        return res.json({ success: false, error: 'Chỉ Admin mới có quyền sửa đổi thông tin User!' });
    }

    db.query(
        'UPDATE users SET role = ?, department = ? WHERE id = ?', 
        [role, department, targetId], 
        (err, result) => {
            if (err) {
                console.error("Lỗi cập nhật User:", err);
                return res.json({ success: false, error: err.message });
            }
            res.json({ success: true });
        }
    );
});
app.delete('/api/users/:id', (req, res) => {
    const targetId = req.params.id;
    const { requester_id, requester_role } = req.body; 
    if (requester_role === 'admin') {
        db.query('DELETE FROM users WHERE id = ?', [targetId], err => res.json({ success: !err, error: err?.message }));
    } else if (requester_role === 'manager') {
        db.query('DELETE FROM users WHERE id = ? AND manager_id = ?', [targetId, requester_id], (err, result) => {
            if (result && result.affectedRows > 0) res.json({ success: true });
            else res.json({ success: false, error: 'Không có quyền xóa user này hoặc user không tồn tại!' });
        });
    } else res.json({ success: false, error: 'Không có quyền thực hiện.' });
});

// --- API QUẢN LÝ THIẾT BỊ ---
app.get('/api/assets', (req, res) => {
    // FIX LỖI ADMIN: Loại bỏ thiết bị ảo GLOBAL ra khỏi danh sách
    const query = `
        SELECT a.*, 
            (SELECT username FROM transactions t WHERE t.qa_code = a.qa_code AND t.action_type = 'Mượn' ORDER BY timestamp DESC LIMIT 1) as current_borrower,
            (SELECT timestamp FROM transactions t WHERE t.qa_code = a.qa_code AND t.action_type = 'Mượn' ORDER BY timestamp DESC LIMIT 1) as borrow_time,
            (SELECT note FROM transactions t WHERE t.qa_code = a.qa_code AND t.action_type = 'Mượn' ORDER BY timestamp DESC LIMIT 1) as borrow_note,
            (SELECT expected_return FROM transactions t WHERE t.qa_code = a.qa_code AND t.action_type = 'Mượn' ORDER BY timestamp DESC LIMIT 1) as expected_return,
            (SELECT COUNT(*) FROM transactions t WHERE t.qa_code = a.qa_code AND t.action_type = 'Đăng ký mượn' AND t.expected_return >= NOW()) as reservations_count
        FROM assets a WHERE a.qa_code != 'GLOBAL'
    `;
    db.query(query, (err, results) => {
        if (err) console.error("Lỗi danh sách:", err);
        res.json(results || []);
    });
});

app.get('/api/assets/:qa_code', (req, res) => {
    db.query('SELECT * FROM assets WHERE qa_code = ?', [req.params.qa_code], (err, results) => {
        if (results && results.length > 0) {
            const asset = results[0];
            db.query('SELECT * FROM transactions WHERE qa_code = ? ORDER BY timestamp DESC', [req.params.qa_code], (err, history) => {
                res.json({ success: true, asset, history: history || [] });
            });
        } else res.json({ success: false, message: 'Không tìm thấy thiết bị' });
    });
});

app.post('/api/assets', (req, res) => {
    db.query('INSERT INTO assets SET ?', req.body, err => res.json({ success: !err, error: err?.message }));
});

app.put('/api/assets/:qa_code', (req, res) => {
    db.query('UPDATE assets SET name=?, type=?, room=?, status=? WHERE qa_code=?', 
        [req.body.name, req.body.type, req.body.room, req.body.status, req.params.qa_code], 
        err => {
            if(!err && req.body.status === 'Sẵn sàng') {
                const sysMsg = `[Hệ thống] Thiết bị đã được sửa chữa thành công và sẵn sàng sử dụng.`;
                db.query("INSERT INTO messages (qa_code, sender, role, message) VALUES (?, 'Hệ thống', 'system', ?)", [req.params.qa_code, sysMsg]);
                io.emit("receiveMessage", { qa_code: req.params.qa_code, sender: 'Hệ thống', role: 'system', message: sysMsg, timestamp: new Date() });
            }
            res.json({ success: !err, error: err?.message });
        });
});

app.delete('/api/assets/:qa_code', (req, res) => {
    db.query('DELETE FROM assets WHERE qa_code=?', [req.params.qa_code], err => res.json({ success: !err, error: err?.message }));
});

app.get('/api/categories', (req, res) => {
    db.query('SELECT DISTINCT type FROM assets WHERE qa_code != "GLOBAL"', (err, results) => res.json(results ? results.map(r => r.type) : []));
});

// --- API XỬ LÝ THAO TÁC MƯỢN/TRẢ ---
app.post('/api/action', (req, res) => {
    const { qa_code, username, role, action_type, note, new_room, expected_return } = req.body;
    db.query('SELECT status FROM assets WHERE qa_code = ?', [qa_code], (err, results) => {
        if (!results || results.length === 0) return res.json({ success: false, message: 'Không tìm thấy thiết bị' });
        
        let newStatus = results[0].status;
        let transactionData = { qa_code, username, action_type, note };
        if (expected_return) transactionData.expected_return = expected_return;

        if (action_type === 'Đăng ký mượn') {
            db.query('SELECT * FROM transactions WHERE qa_code = ? AND username = ? AND action_type = "Đăng ký mượn"', [qa_code, username], (err, exist) => {
                if (exist && exist.length > 0) return res.json({ success: false, message: 'Bạn đã đăng ký mượn thiết bị này rồi!' });
                db.query('INSERT INTO transactions SET ?', transactionData, () => res.json({ success: true, newStatus }));
            });
            return;
        }

        if (action_type === 'Mượn') {
            if (newStatus !== 'Sẵn sàng') return res.json({ success: false, message: `Thiết bị đang ${newStatus}` });
            
            if (role !== 'admin' && role !== 'manager') {
                newStatus = 'Chờ duyệt';
                transactionData.action_type = 'Yêu cầu mượn';
            } else newStatus = 'Đang sử dụng';
            
            const updateRoomQuery = new_room ? 'UPDATE assets SET status = ?, room = ? WHERE qa_code = ?' : 'UPDATE assets SET status = ? WHERE qa_code = ?';
            const updateParams = new_room ? [newStatus, new_room, qa_code] : [newStatus, qa_code];
            
            db.query(updateRoomQuery, updateParams, () => {
                db.query('INSERT INTO transactions SET ?', transactionData, () => res.json({ success: true, newStatus }));
            });
        } else if (action_type === 'Trả') {
            db.query('SELECT * FROM transactions WHERE qa_code = ? AND action_type = "Đăng ký mượn" AND expected_return >= NOW() ORDER BY timestamp ASC LIMIT 1', [qa_code], (err, pendingRes) => {
                if (pendingRes && pendingRes.length > 0) {
                    const nextReq = pendingRes[0];
                    db.query('SELECT role FROM users WHERE username = ?', [nextReq.username], (err, userRes) => {
                        const nextRole = (userRes && userRes.length > 0) ? userRes[0].role : 'staff';
                        const autoStatus = (nextRole === 'admin' || nextRole === 'manager') ? 'Đang sử dụng' : 'Chờ duyệt';
                        const nextAction = (nextRole === 'admin' || nextRole === 'manager') ? 'Mượn' : 'Yêu cầu mượn';
                        
                        db.query('DELETE FROM transactions WHERE id = ?', [nextReq.id], () => {
                            db.query('UPDATE assets SET status = ? WHERE qa_code = ?', [autoStatus, qa_code], () => {
                                db.query('INSERT INTO transactions SET ?', { qa_code, username: nextReq.username, action_type: nextAction, note: 'Tự động chuyển từ Đặt lịch: ' + nextReq.note, expected_return: nextReq.expected_return }, () => {
                                    db.query('INSERT INTO transactions SET ?', { qa_code, username, action_type: 'Trả', note }, () => res.json({ success: true, newStatus: autoStatus }));
                                });
                            });
                        });
                    });
                } else {
                    db.query('UPDATE assets SET status = "Sẵn sàng" WHERE qa_code = ?', [qa_code], () => {
                        db.query('INSERT INTO transactions SET ?', { qa_code, username, action_type: 'Trả', note }, () => res.json({ success: true, newStatus: "Sẵn sàng" }));
                    });
                }
            });
        } else if (action_type === 'Báo hỏng') {
            db.query('UPDATE assets SET status = "Hỏng" WHERE qa_code = ?', [qa_code], () => {
                db.query('INSERT INTO transactions SET ?', transactionData, () => {
                    const sysMsg = `[Hệ thống] ${username} (${role === 'staff' ? 'Nhân viên' : 'Quản lý'}) đã báo hỏng thiết bị. Lý do: ${note}`;
                    db.query("INSERT INTO messages (qa_code, sender, role, message) VALUES (?, 'Hệ thống', 'system', ?)", [qa_code, sysMsg], () => {
                        io.emit("receiveMessage", { qa_code, sender: 'Hệ thống', role: 'system', message: sysMsg, timestamp: new Date() });
                        res.json({ success: true, newStatus: "Hỏng" });
                    });
                });
            });
        }
    });
});
app.get('/api/maintenance', (req, res) => {
    const query = `
        SELECT a.qa_code, a.name, a.status,
            (SELECT username FROM transactions t WHERE t.qa_code = a.qa_code AND t.action_type = 'Báo hỏng' ORDER BY timestamp DESC LIMIT 1) as reporter,
            (SELECT note FROM transactions t WHERE t.qa_code = a.qa_code AND t.action_type = 'Báo hỏng' ORDER BY timestamp DESC LIMIT 1) as error_note,
            (SELECT timestamp FROM transactions t WHERE t.qa_code = a.qa_code AND t.action_type = 'Báo hỏng' ORDER BY timestamp DESC LIMIT 1) as report_time
        FROM assets a 
        WHERE a.status IN ('Hỏng', 'Bảo trì')
    `;
    db.query(query, (err, results) => res.json(results || []));
});
app.post('/api/approve', (req, res) => {
    const { qa_code, admin_username, decision } = req.body; 
    db.query('SELECT * FROM transactions WHERE qa_code = ? AND action_type = "Yêu cầu mượn" ORDER BY timestamp DESC LIMIT 1', [qa_code], (err, trans) => {
        if (!trans || trans.length === 0) return res.json({ success: false, message: 'Không tìm thấy yêu cầu mượn' });
        
        const reqData = trans[0];
        let newStatus = decision === 'approve' ? 'Đang sử dụng' : 'Sẵn sàng';
        let newAction = decision === 'approve' ? 'Mượn' : 'Từ chối mượn';

        db.query('UPDATE assets SET status = ? WHERE qa_code = ?', [newStatus, qa_code], () => {
            db.query('INSERT INTO transactions SET ?', {
                qa_code, username: reqData.username, action_type: newAction,
                note: decision === 'approve' ? `Quản lý (${admin_username}) đã duyệt: ${reqData.note}` : `Quản lý (${admin_username}) đã từ chối`,
                expected_return: reqData.expected_return
            }, () => res.json({ success: true, newStatus }));
        });
    });
});
// --- API QUẢN LÝ LỊCH BẢO TRÌ & THANH LÝ (TÍNH NĂNG MỚI) ---
app.get('/api/maint-logs', (req, res) => {
    const query = `
        SELECT m.*, a.name as asset_name 
        FROM maintenance_logs m 
        JOIN assets a ON m.qa_code = a.qa_code 
        ORDER BY m.schedule_date DESC
    `;
    db.query(query, (err, results) => {
        if(err) console.error("Lỗi lấy lịch bảo trì:", err);
        res.json(results || []);
    });
});

app.post('/api/maint-logs', (req, res) => {
    const { qa_code, type, schedule_date, tech_name } = req.body;
    db.query('INSERT INTO maintenance_logs (qa_code, type, schedule_date, tech_name) VALUES (?, ?, ?, ?)', 
    [qa_code, type, schedule_date, tech_name], 
    err => res.json({ success: !err, error: err?.message }));
});

app.put('/api/maint-logs/:id/cost', (req, res) => {
    const { cost } = req.body;
    db.query('UPDATE maintenance_logs SET cost = ? WHERE id = ?', [cost, req.params.id], 
    err => res.json({ success: !err, error: err?.message }));
});

app.put('/api/maint-logs/:id/status', (req, res) => {
    const { status } = req.body;
    db.query('UPDATE maintenance_logs SET status = ? WHERE id = ?', [status, req.params.id], 
    err => res.json({ success: !err, error: err?.message }));
});
server.listen(3000, () => console.log('Server Node.js chạy tại http://localhost:3000'));
