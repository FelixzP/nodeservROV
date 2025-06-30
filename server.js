const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(cors({
    origin: '*', // อนุญาตทุก origin
}));
app.use('/Assets', express.static('/Assets')); // เสิร์ฟไฟล์ Assets

// เชื่อมต่อฐานข้อมูล
const db = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '_39108401_#Pp',
    database: 'rov'
});

// ฟังก์ชั่นดึงฮีโร่ทั้งหมด
async function getHeroes() {
    const [rows] = await db.query('SELECT id, name, img FROM rov');
    return rows;
}

// API ดึงฮีโร่
app.get('/api/heroes', async (req, res) => {
    try {
        const heroes = await getHeroes();
        res.json(heroes);
    } catch (error) {
        console.error('Error fetching heroes:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ตัวแปร Timer และ Phase
let currentPhaseIndex = 0;
let timer = 60;
let timerInterval;

const phases = [
    { type: "Blue Ban Phase", direction: "/Assets/Other/Left.gif" },
    { type: "Red Ban Phase", direction: "/Assets/Other/Right.gif" },
    { type: "Blue Ban Phase", direction: "/Assets/Other/Left.gif" },
    { type: "Red Ban Phase", direction: "/Assets/Other/Right.gif" },
];

function startTimer() {
    clearInterval(timerInterval);
    timer = 60;

    timerInterval = setInterval(() => {
        if (timer > 0) {
            timer--;
            io.emit('timerUpdate', { timer, currentPhaseIndex });
        } else {
            clearInterval(timerInterval);
            moveToNextPhase();
        }
    }, 1000);
}

function moveToNextPhase() {
    if (currentPhaseIndex < phases.length - 1) {
        currentPhaseIndex++;
        io.emit('phaseUpdate', { phase: phases[currentPhaseIndex], timer: 60 });
        startTimer();
    } else {
        io.emit('phaseUpdate', { phase: { type: "Adjustment", direction: "/Assets/Other/Adjustment.gif" }, timer: "Adjustment" });
    }
}

// WebSocket
io.on('connection', async (socket) => {
    console.log('Client connected: ' + socket.id);

    // ดึงฮีโร่ทั้งหมด
    const heroes = await getHeroes();

    // ดึงฮีโร่ที่เลือกไว้จากฐานข้อมูล
    const [selectedRows] = await db.query(`
        SELECT sh.position_id, r.id, r.name, r.img
        FROM selected_heroes sh
        JOIN rov r ON sh.hero_id = r.id
    `);

    // ส่งข้อมูลเริ่มต้น
    socket.emit('initData', { heroes, phase: phases[currentPhaseIndex], timer, selectedHeroes: selectedRows });

    // รับข้อมูลเมื่อเลือกฮีโร่
socket.on('selectHero', async (data) => {
    const { heroId, positionId } = data;

    try {
        // ตรวจสอบว่ามี position_id นี้ใน selected_heroes หรือยัง
        const [rows] = await db.query('SELECT * FROM selected_heroes WHERE position_id = ?', [positionId]);

        if (rows.length > 0) {
            // อัพเดต hero_id ในตำแหน่งนั้น
            await db.query('UPDATE selected_heroes SET hero_id = ? WHERE position_id = ?', [heroId, positionId]);
        } else {
            // เพิ่ม record ใหม่
            await db.query('INSERT INTO selected_heroes (position_id, hero_id) VALUES (?, ?)', [positionId, heroId]);
        }

        // ดึงข้อมูล hero จริงจากตาราง rov
        const [heroRows] = await db.query('SELECT id, name, img FROM rov WHERE id = ?', [heroId]);
        const selectedHero = heroRows[0]; // ข้อมูลฮีโร่ที่เลือก

        // ส่งข้อมูลไปยัง client ทุกตัว (broadcast)
        io.emit('heroSelected', { hero: selectedHero, positionId });

    } catch (err) {
        console.error('Error inserting/updating selected hero:', err);
    }
});



    // ดึงข้อมูลฮีโร่ที่ถูกเลือกทั้งหมด
    socket.on('getSelectedHeroes', async () => {
        const [rows] = await db.query(`
            SELECT sh.position_id, r.id, r.name, r.img
            FROM selected_heroes sh
            JOIN rov r ON sh.hero_id = r.id
        `);
        socket.emit('initSelectedHeroes', rows);
    });

    socket.on('resetPick', async () => {
        try {
            // อัพเดต hero_id เป็น NULL ทั้งหมดใน selected_heroes
            await db.query('UPDATE selected_heroes SET hero_id = NULL');
            // แจ้ง client ทุกตัวให้เคลียร์ภาพเลือกตัว
            io.emit('resetSelectedHeroes');
            console.log('All hero picks reset in database.');
        } catch (error) {
            console.error('Error resetting hero picks:', error);
        }
    });
    
    // เปลี่ยน Phase
    socket.on('nextPhase', () => {
        clearInterval(timerInterval);
        moveToNextPhase();
    });

    // รีเซ็ตระบบทั้งหมด
    socket.on('reset', async () => {
        clearInterval(timerInterval);
        currentPhaseIndex = 0;
        timer = 60;

        // ล้างข้อมูลฮีโร่ที่เลือกใน database
        await db.query('DELETE FROM selected_heroes');

        // ส่ง phase เริ่มต้นและแจ้งให้ client ล้างภาพทั้งหมด
        io.emit('phaseUpdate', { phase: phases[0], timer: 60 });
        io.emit('resetSelectedHeroes');

        startTimer();
    });

    // เริ่ม timer ถ้ายังไม่เริ่ม
    if (!timerInterval) startTimer();

    // เมื่อ client ออกจากระบบ
    socket.on('disconnect', () => {
        console.log('Client disconnected: ' + socket.id);
    });
});

// Start Server
server.listen(3000, '0.0.0.0', () => console.log('Server running on port 3000'));
