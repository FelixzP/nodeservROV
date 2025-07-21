const express = require('express');
const http = require('http');

const socketIo = require('socket.io');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });


app.use(cors({ origin: '*', credentials: true }));

app.use('/Assets', express.static('/Assets')); // เสิร์ฟไฟล์ Assets
app.set('trust proxy', true);


// เชื่อมต่อฐานข้อมูล
const db = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'rov',
    waitForConnections: true
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
app.use(express.json());

// API รับ update ชื่อทีม
app.post('/api/updateTeamName', async (req, res) => {
  try {
    const { side, name } = req.body;

    if (!side || !name) {
      return res.status(400).json({ success: false, message: 'Missing side or name' });
    }

    // สมมติตาราง team_names มีคอลัมน์ side (blue/red) กับ name
    const sql = `
      INSERT INTO team_names (side, name)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE name = VALUES(name)
    `;
    
    await db.query(sql, [side, name]);
    const teamPayload = {
  side,
  name,
  teamNumber: side === 'blue' ? 1 : 2
};

io.emit('teamNameUpdated', teamPayload);


    return res.json({ success: true });
  } catch (err) {
    console.error('Error updating team name:', err);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

app.get('/api/getTeamNames', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT side, name FROM team_names');
    res.json(rows); // ✅ ดึงชื่อทีมจากฐานข้อมูลจริง
  } catch (err) {
    console.error('Error fetching team names:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// swapheroes
app.post('/api/swap-heroes', async (req, res) => {
    let { positionId1, positionId2 } = req.body;
    let heroId1, heroId2;
    try {
        console.log('Swap Request:', positionId1, positionId2);

        // ดึง hero_id ของทั้งสองตำแหน่ง
        let [rows1] = await db.query('SELECT hero_id FROM selected_heroes WHERE position_id = ?', [positionId1]);
        let [rows2] = await db.query('SELECT hero_id FROM selected_heroes WHERE position_id = ?', [positionId2]);

        if (!rows1.length || !rows2.length) {
            console.log('One of the positions not found');
            return res.status(404).json({ success: false, error: 'One or both positions not found in database' });
        }

        heroId1 = rows1[0].hero_id;
        heroId2 = rows2[0].hero_id;

        // สลับ hero_id ของทั้งสอง position_id
        const [result1] = await db.query('UPDATE selected_heroes SET hero_id = ? WHERE position_id = ?', [heroId1, positionId2]);
        const [result2] = await db.query('UPDATE selected_heroes SET hero_id = ? WHERE position_id = ?', [heroId2, positionId1]);
        console.log('Update result 1:', result1);
        console.log('Update result 2:', result2);
        // แจ้งทุก client ให้ดึงข้อมูลใหม่
        // ส่งข้อมูลที่อัปเดตเฉพาะตำแหน่งและฮีโร่ให้ client ทุกตัว



        res.json({ success: true });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
    io.emit('updateSelectedHeroes', {
        updatedHeroes: [
            { positionId: positionId1, heroId: heroId2 },
            { positionId: positionId2, heroId: heroId1 }
        ]
    });
});
//ชื่อทัวร์นาเมนต์
app.post('/api/update-tournament-name', async (req, res) => {
    const { tournamentName } = req.body;

    try {
        await db.query('UPDATE tournament SET name = ? WHERE id = 1', [tournamentName]);

        io.emit('tournamentNameUpdated', { tournamentName }); // Broadcast ให้ทุกเครื่องรู้

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating tournament name:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});
//คะแนน
app.post('/api/update-score', async (req, res) => {
    const { blueScore, redScore } = req.body;
    
    try {
        await db.query('UPDATE tournament SET blue_score = ?, red_score = ? WHERE id = 1', [blueScore, redScore]);

        io.emit('scoreUpdate', { blueScore, redScore }); // Broadcast ให้ทุกเครื่องรู้

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating score:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});
//ชื่อทัวร์นาเม้นปัจจุบัน
// โหลดข้อมูล tournament ตอนเปิดหน้าเว็บ
app.get('/api/get-tournament', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM tournament WHERE id = 1');
        if (rows.length > 0) {
            res.json(rows[0]);
        } else {
            res.status(404).json({ error: 'Tournament not found' });
        }
    } catch (error) {
        console.error('Error fetching tournament:', error);
        res.status(500).json({ error: 'Database error' });
    }
});
app.post('/api/reset-score', async (req, res) => {
    try {
        await db.query('UPDATE tournament SET blue_score = 0, red_score = 0 WHERE id = 1');
        
        // Broadcast ให้ทุก client รู้ว่าคะแนนถูกรีเซ็ตแล้ว
        io.emit('scoreUpdate', { blueScore: 0, redScore: 0 });

        res.json({ success: true });
    } catch (error) {
        console.error('Error resetting score:', error);
        res.status(500).json({ success: false });
    }
});



// ตัวแปร Timer และ Phase
let currentPhaseIndex = 0;
let timer = 60;
let timerInterval = null;
let isTimerRunning = false;
const phases = [
    { type: "Blue Ban Phase", direction: "/Assets/Other/Left.gif" },
    { type: "Red Ban Phase", direction: "/Assets/Other/Right.gif" },
    { type: "Blue Ban Phase", direction: "/Assets/Other/Left.gif" },
    { type: "Red Ban Phase", direction: "/Assets/Other/Right.gif" },
    { type: "Blue Pick Phase", direction: "/Assets/Other/Left.gif" },
    { type: "Red Pick Phase", direction: "/Assets/Other/Right.gif" },
    { type: "Blue Pick Phase", direction: "/Assets/Other/Left.gif" },
    { type: "Red Pick Phase", direction: "/Assets/Other/Right.gif" },
    { type: "Red Ban Phase", direction: "/Assets/Other/Right.gif" },
    { type: "Blue Ban Phase", direction: "/Assets/Other/Left.gif" },
    { type: "Red Ban Phase", direction: "/Assets/Other/Right.gif" },
    { type: "Blue Ban Phase", direction: "/Assets/Other/Left.gif" },
    { type: "Red Pick Phase", direction: "/Assets/Other/Right.gif" },
    { type: "Blue Pick Phase", direction: "/Assets/Other/Left.gif" },
    { type: "Red Pick Phase", direction: "/Assets/Other/Right.gif" },
];

function startTimer() {
    if (isTimerRunning) return;

    isTimerRunning = true;

    clearInterval(timerInterval); // ✅ เคลียร์ timer เก่าก่อน

    timerInterval = setInterval(() => {
        if (timer > 0) {
            timer--;
            io.emit('timerUpdate', { timer });
        } else {
            clearInterval(timerInterval);
            timerInterval = null;
            isTimerRunning = false;
            moveToNextPhase();
        }
    }, 1000);
}


function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
        isTimerRunning = false;
        io.emit('timerUpdate', { timer, currentPhaseIndex }); // ส่งเวลาล่าสุดให้ client
        console.log('Timer stopped');
    }
}

function resetTimerAndPhase(sendToAll = true, socket = null) {
    clearInterval(timerInterval);
    timerInterval = null;
    isTimerRunning = false;

    currentPhaseIndex = 0;
    timer = 60;

    const updateData = {
        phase: phases[currentPhaseIndex],
        timer,
        currentPhaseIndex
    };

    if (sendToAll) {
        io.emit('phaseUpdate', updateData);
        io.emit('timerUpdate', updateData);
        io.emit('resetSelectedHeroes');
    } else if (socket) {
        socket.emit('phaseUpdate', updateData);
        socket.emit('timerUpdate', updateData);
        // socket.emit('resetSelectedHeroes');
    }
}



function moveToNextPhase() {
    clearInterval(timerInterval); 
    timerInterval = null;
    isTimerRunning = false;

    currentPhaseIndex++;

    if (currentPhaseIndex >= phases.length) {
        io.emit('phaseUpdate', { phase: { type: "Finalizing", direction: "/Assets/Other/Adjustment.gif" }, timer: "VS", currentPhaseIndex });
        return;
    }

    timer = 60;

    io.emit('phaseUpdate', { phase: phases[currentPhaseIndex], timer, currentPhaseIndex }); // ✅ เพิ่ม currentPhaseIndex ตรงนี้

    startTimer(); 
}




// WebSocket
io.on('connection', async (socket) => {
    console.log('Client connected: ' + socket.id);
//    socket.emit('phaseUpdate', { phase: phases[currentPhaseIndex], timer });
    // socket.emit('timerUpdate', { timer, currentPhaseIndex });
    // ดึงฮีโร่ทั้งหมด
    try{
        const [nicknameRows] = await db.query('SELECT * FROM nicknames');
socket.emit('nicknameInit', nicknameRows);
    const heroes = await getHeroes();
    const [tournamentRows] = await db.query('SELECT blue_score, red_score FROM tournament WHERE id = 1');
const blueScore = tournamentRows[0].blue_score;
const redScore = tournamentRows[0].red_score;
 const [teamRows] = await db.query('SELECT side, name FROM team_names');
        let team1 = '', team2 = '';
        teamRows.forEach(row => {
            if (row.side === 'blue') team1 = row.name;
            else if (row.side === 'red') team2 = row.name;
        });

    // ดึงฮีโร่ที่เลือกไว้จากฐานข้อมูล
    const [selectedRows] = await db.query(`
        SELECT sh.position_id, r.id, r.name, r.img
        FROM selected_heroes sh
        JOIN rov r ON sh.hero_id = r.id
    `);

    // ส่งข้อมูลเริ่มต้น
    // io.emit('scoreUpdate', { blueScore, redScore });
     let phaseInfo;
        let displayTimer = timer;

        if (currentPhaseIndex >= phases.length) {
            phaseInfo = { type: "Finalizing", direction: "/Assets/Other/Adjustment.gif" };
            displayTimer = "VS";
        } else {
            phaseInfo = phases[currentPhaseIndex];
        }


const initPayload = {
            heroes,
            phase: phaseInfo,
            timer: displayTimer,
            selectedHeroes: selectedRows,
            blueScore,
            redScore,
            currentPhaseIndex,
            team1,  
            team2   
        };

        console.log('📤 Emitting initData to', socket.id, initPayload.phase);
        console.log('📌 Sending phase info:', phases[currentPhaseIndex]);

        socket.emit('initData', initPayload);    
    }catch (error){
        console.error('❌ Error during init connection:', error);
    }

    socket.on('requestInit', async () => {
        console.log('📥 Manual requestInit from', socket.id);


        // Copy logic ด้านบนมาใช้อีกครั้งก็ได้ หรือแยกเป็น function
        // เพื่อความกระชับ:
        io.emit('phaseUpdate', {
            phase: (currentPhaseIndex < phases.length)
                ? phases[currentPhaseIndex]
                : { type: "Finalizing", direction: "/Assets/Other/Adjustment.gif" },
            timer: (currentPhaseIndex < phases.length) ? timer : "VS",
            currentPhaseIndex
        });

        socket.emit('timerUpdate', { timer, currentPhaseIndex });
        // socket.emit('resetSelectedHeroes');
    });

    // รับ nickname ใหม่จาก client
socket.on('updateNickname', async ({ positionId, nickname }) => {
    try {
        const [rows] = await db.query('SELECT * FROM nicknames WHERE position_id = ?', [positionId]);
        if (rows.length > 0) {
            await db.query('UPDATE nicknames SET nickname = ? WHERE position_id = ?', [nickname, positionId]);
        } else {
            await db.query('INSERT INTO nicknames (position_id, nickname) VALUES (?, ?)', [positionId, nickname]);
        }
    
        // ส่งข้อมูล nickname ใหม่ไปยังทุก client
        io.emit('nicknameUpdated', { positionId, nickname });
    } catch (err) {
        console.error('Nickname DB error:', err);
    }
    resetTimerAndPhase(true); //หมนุทวนเวลา
});
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

    socket.on('scoreUpdated', async () => {
        // ดึงคะแนนล่าสุดจาก database
        const [rows] = await db.query('SELECT blue_score, red_score FROM tournament WHERE id = 1');
        const latestScore = rows[0];

        // broadcast ให้ทุก client อัปเดตคะแนน
        io.emit('scoreUpdate', { blueScore: latestScore.blue_score, redScore: latestScore.red_score });
    });
    // ดึงข้อมูลฮีโร่ที่ถูกเลือกทั้งหมด
    // socket.on('getSelectedHeroes', async () => {
    //     const [rows] = await db.query(`
    //         SELECT sh.position_id, r.id, r.name, r.img
    //         FROM selected_heroes sh
    //         JOIN rov r ON sh.hero_id = r.id
    //     `);
    //     socket.emit('initSelectedHeroes', rows);
    // });

    socket.on('getSelectedHeroes', async () => {
        try {
            const [rows] = await db.query(`
            SELECT sh.position_id, r.id, r.name, r.img
            FROM selected_heroes sh
            JOIN rov r ON sh.hero_id = r.id
        `);
            socket.emit('initSelectedHeroes', rows); // ส่งให้ client อัปเดต
        } catch (error) {
            console.error('Error fetching selected heroes:', error);
        }
    });

socket.on('startTimer', () => {
    console.log('Start timer event received');
    startTimer();
});

    // stop timer event
    socket.on('stopTimer', () => {
        console.log('Stop timer event received');
        stopTimer();
    });

    // reset event
    socket.on('reset', async () => {
    console.log('Reset event received');
    await db.query('DELETE FROM selected_heroes');
    await db.query('UPDATE nicknames SET nickname = ""');

    // ดึง position_id ทั้งหมดจาก nicknames
    const [rows] = await db.query('SELECT position_id FROM nicknames');

    // ส่ง nickname ว่างไปยังทุก position
    for (const row of rows) {
        io.emit('nicknameUpdated', { positionId: row.position_id, nickname: '' });
    }
    
    resetTimerAndPhase(true); // ✅ ส่งไปทุก client จริง ๆ
});
// reset event
    socket.on('resetPick', async () => {
    console.log('Reset Pick event received');
    await db.query('DELETE FROM selected_heroes');

    // ดึง position_id ทั้งหมดจาก nicknames
    const [rows] = await db.query('SELECT position_id FROM nicknames');

    // // ส่ง nickname ว่างไปยังทุก position
    // for (const row of rows) {
    //     io.emit('nicknameUpdated', { positionId: row.position_id, nickname: '' });
    // }
    
    resetTimerAndPhase(true); // ✅ ส่งไปทุก client จริง ๆ
});

    // next phase event
    socket.on('nextPhase', () => {
        console.log('Next phase event received');
        // stopTimer(); // หยุด timer ปัจจุบัน
        moveToNextPhase();
    });

 // เมื่อ client ออกจากระบบ
    socket.on('disconnect', () => {
        console.log('Client disconnected: ' + socket.id);
    });
    // เริ่ม timer ถ้ายังไม่เริ่ม ไม่ใช้
    // if (!timerInterval) startTimer();
    
});


// Start Server
server.listen(3000, '0.0.0.0', () => console.log('Server running on port 3000'));
