console.log("🚀 Starting Blackjack Online...");

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.static("public"));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ====== MongoDB ======
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true, useUnifiedTopology: true
}).then(()=>console.log("✅ MongoDB connected")).catch(e=>console.error("❌ Mongo error", e));

const playerSchema = new mongoose.Schema({
  name: { type: String, unique: true, index: true },
  chips: { type: Number, default: 1000 },
  lastLogin: { type: Date, default: Date.now },
  stats: {
    hands: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    pushes: { type: Number, default: 0 }
  }
});
const Player = mongoose.model("Player", playerSchema);

const handSchema = new mongoose.Schema({
  ts: { type: Date, default: Date.now },
  table: String,
  shoeId: String,
  seats: [{
    name: String,
    bet: Number,
    cards: [String],
    result: String,
    payout: Number
  }],
  dealer: [String]
});
const HandHistory = mongoose.model("HandHistory", handSchema);

// ====== Game core ======
const SUITS = ["S","H","D","C"]; // Spade, Heart, Diamond, Club
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

function cryptoRand() {
  // Uniform float [0,1)
  if (global.crypto?.getRandomValues) {
    const u32 = new Uint32Array(1);
    global.crypto.getRandomValues(u32);
    return u32[0] / 2**32;
  }
  // Node crypto
  const { randomBytes } = require("crypto");
  return randomBytes(4).readUInt32BE(0) / 2**32;
}

function makeShoe(decks = 6) {
  const arr = [];
  for (let d=0; d<decks; d++) {
    for (const s of SUITS) for (const r of RANKS) arr.push(`${r}${s}`);
  }
  // Fisher–Yates
  for (let i=arr.length-1; i>0; i--) {
    const j = Math.floor(cryptoRand() * (i+1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function cardVal(r) {
  if (r==="A") return 11;
  if (["J","Q","K"].includes(r)) return 10;
  return Number(r);
}
function parseRank(card) { // "10S" -> "10"
  return card.startsWith("10") ? "10" : card[0];
}
function handTotal(cards) {
  let sum = 0, aces = 0;
  for (const c of cards) {
    const r = parseRank(c);
    sum += cardVal(r);
    if (r === "A") aces++;
  }
  while (sum > 21 && aces > 0) {
    sum -= 10; aces--;
  }
  return sum;
}
function isBJ(cards) {
  return cards.length === 2 && handTotal(cards) === 21;
}

// ====== Table state (1 table "main") ======
const TABLE_ID = "main";
const MAX_SEATS = 5;

const table = {
  shoe: makeShoe(6),
  shoeId: Math.random().toString(36).slice(2,8),
  phase: "lobby", // lobby|betting|dealing|acting|dealer|payout
  dealer: [],
  seats: [
    // { seat:0.., socketId, name, chipsCache, bet, cards, done, busted, stood, result, payout }
  ]
};

function broadcastTable() {
  io.to(TABLE_ID).emit("tableState", safeState());
}
function safeState() {
  // Không lộ lá dealer úp trong phase acting
  const dealerPublic = [...table.dealer];
  if (["acting"].includes(table.phase) && dealerPublic.length>0) {
    dealerPublic[0] = "##"; // úp lá đầu
  }
  return {
    tableId: TABLE_ID,
    phase: table.phase,
    dealer: dealerPublic,
    seats: table.seats.map(s => ({
      seat: s.seat, name: s.name, bet: s.bet ?? 0, cards: s.cards ?? [],
      done: !!s.done, stood: !!s.stood, busted: !!s.busted, socketId: s.socketId
    })),
    shoeLeft: table.shoe.length
  };
}

function seatBySocket(id){ return table.seats.find(s=>s.socketId===id); }
function seatIndexFree() {
  for (let i=0;i<MAX_SEATS;i++){
    if (!table.seats.find(s=>s.seat===i)) return i;
  }
  return -1;
}
function ensureShoe(){
  if (table.shoe.length < 60) {
    table.shoe = makeShoe(6);
    table.shoeId = Math.random().toString(36).slice(2,8);
  }
}
function dealCard() {
  ensureShoe();
  return table.shoe.pop();
}
function resetRound() {
  table.dealer = [];
  table.seats.forEach(s=>{
    s.cards = []; s.bet = 0; s.done=false; s.busted=false; s.stood=false; s.result=null; s.payout=0;
  });
  table.phase = "betting";
}

// ====== Socket.io ======
io.on("connection", (socket) => {
  console.log("🔌", socket.id, "connected");

  socket.on("joinGame", async (name) => {
    if (!name || typeof name !== "string") return socket.emit("errorMsg", "Tên không hợp lệ");
    name = name.trim().slice(0,24);

    let player = await Player.findOne({ name });
    if (!player) player = await Player.create({ name, chips: 1000 });
    else await Player.updateOne({ name }, { $set: { lastLogin: new Date() } });

    socket.data.name = name;
    socket.join(TABLE_ID);

    socket.emit("welcome", { name, chips: player.chips });
    broadcastTable();
  });

  socket.on("sitDown", async () => {
    if (!socket.data.name) return;
    if (table.phase !== "lobby" && table.phase !== "betting") {
      return socket.emit("errorMsg", "Không thể ngồi ghế lúc này");
    }
    if (seatBySocket(socket.id)) return; // đã ngồi
    const idx = seatIndexFree();
    if (idx === -1) return socket.emit("errorMsg", "Bàn đã đầy");
    table.seats.push({ seat: idx, socketId: socket.id, name: socket.data.name });
    broadcastTable();
  });

  socket.on("standUp", () => {
    const s = seatBySocket(socket.id);
    if (!s) return;
    if (table.phase!=="lobby" && table.phase!=="betting") {
      return socket.emit("errorMsg","Đang trong ván, không thể rời ghế");
    }
    table.seats = table.seats.filter(x=>x.socketId!==socket.id);
    broadcastTable();
  });

  socket.on("startBetting", () => {
    if (table.phase === "lobby") {
      resetRound();
      broadcastTable();
    }
  });

  socket.on("placeBet", async (amount) => {
    amount = Math.floor(Number(amount)||0);
    if (amount < 10) return socket.emit("errorMsg","Cược tối thiểu 10");
    const s = seatBySocket(socket.id);
    if (!s) return socket.emit("errorMsg","Bạn chưa ngồi ghế");
    if (!["betting"].includes(table.phase)) return socket.emit("errorMsg","Không ở phase đặt cược");

    const p = await Player.findOne({ name: s.name });
    if (!p || p.chips < amount) return socket.emit("errorMsg","Không đủ chip");
    s.bet = amount;
    await Player.updateOne({ name: s.name }, { $inc: { chips: -amount } });
    io.to(TABLE_ID).emit("playerChips", { name: s.name, delta: -amount });
    broadcastTable();
  });

  socket.on("dealNow", () => {
    if (table.phase !== "betting") return;
    if (table.seats.length === 0) return;
    // Ít nhất một người đã đặt cược
    if (!table.seats.some(s => (s.bet||0) > 0)) return;

    table.phase = "dealing";
    table.dealer = [dealCard(), dealCard()];
    table.seats.forEach(s => {
      if ((s.bet||0)>0) {
        s.cards = [dealCard(), dealCard()];
      } else {
        s.cards = [];
        s.done = true;
      }
    });

    // Kiểm tra Blackjack tự nhiên
    const dealerBJ = isBJ(table.dealer);
    table.seats.forEach(s=>{
      if (!s.cards?.length) return;
      const bj = isBJ(s.cards);
      if (bj || dealerBJ) s.done = true; // sẽ quyết toán ngay ở payout phase
    });

    // Nếu có người chưa xong → acting, ngược lại nhảy dealer/payout
    if (!dealerBJ && table.seats.some(s=>s.cards?.length && !s.done)) {
      table.phase = "acting";
      table.seats.forEach(s=>{ s.turn = false; });
      // Chọn người đầu tiên còn hành động
      const first = table.seats.find(s=>s.cards?.length && !s.done);
      if (first) first.turn = true;
    } else {
      // dealer lật luôn
      table.phase = dealerBJ ? "payout" : "dealer";
    }
    broadcastTable();
  });

  socket.on("hit", () => {
    if (table.phase !== "acting") return;
    const s = seatBySocket(socket.id);
    if (!s || !s.turn) return;
    s.cards.push(dealCard());
    const total = handTotal(s.cards);
    if (total > 21) { s.busted = true; s.done = true; s.turn = false; nextTurn(); }
    broadcastTable();
  });

  socket.on("stand", () => {
    if (table.phase !== "acting") return;
    const s = seatBySocket(socket.id);
    if (!s || !s.turn) return;
    s.stood = true; s.done = true; s.turn = false;
    nextTurn();
    broadcastTable();
  });

  function nextTurn() {
    // tìm người tiếp theo còn hành động
    const idx = table.seats.findIndex(x=>x.turn);
    if (idx !== -1) table.seats[idx].turn = false;
    const next = table.seats.find(x=>x.cards?.length && !x.done);
    if (next) {
      next.turn = true;
      table.phase = "acting";
    } else {
      table.phase = "dealer";
      // Dealer rút đến khi >=17
      while (handTotal(table.dealer) < 17) {
        table.dealer.push(dealCard());
      }
      table.phase = "payout";
      settleAndSave();
    }
  }

  function settleAndSave(){
    const dT = handTotal(table.dealer);
    const dealerBJ = isBJ(table.dealer);
    const seatsSnapshot = [];
    table.seats.forEach(s=>{
      if ((s.bet||0) <= 0 || !s.cards?.length) return;

      const pT = handTotal(s.cards);
      let result, payout = 0;

      if (isBJ(s.cards) && dealerBJ) { result="push"; payout = s.bet; }
      else if (isBJ(s.cards)) { result="win_bj"; payout = Math.floor(s.bet * 2.5); }
      else if (dealerBJ) { result="lose"; payout = 0; }
      else if (s.busted) { result="lose"; payout = 0; }
      else if (dT > 21) { result="win"; payout = s.bet * 2; }
      else if (pT > dT) { result="win"; payout = s.bet * 2; }
      else if (pT < dT) { result="lose"; payout = 0; }
      else { result="push"; payout = s.bet; }

      s.result = result;
      s.payout = payout;

      // trả tiền (payout) về tài khoản
      Player.updateOne(
        { name: s.name },
        {
          $inc: {
            chips: payout,
            "stats.hands": 1,
            "stats.wins": (result.startsWith("win")?1:0),
            "stats.losses": (result==="lose"?1:0),
            "stats.pushes": (result==="push"?1:0)
          }
        }
      ).then(()=> {
        io.to(TABLE_ID).emit("playerChips", { name: s.name, delta: payout });
      });

      seatsSnapshot.push({
        name: s.name, bet: s.bet, cards: s.cards, result, payout
      });
    });

    // Lưu hand history
    HandHistory.create({
      table: TABLE_ID,
      shoeId: table.shoeId,
      seats: seatsSnapshot,
      dealer: [...table.dealer]
    }).catch(()=>{});

    // Gửi kết quả & về phase lobby
    io.to(TABLE_ID).emit("roundResult", {
      dealer: table.dealer,
      seats: table.seats.map(s=>({
        seat: s.seat, name: s.name, bet: s.bet||0, cards: s.cards||[],
        result: s.result||null, payout: s.payout||0
      }))
    });

    // Chuẩn bị vòng sau
    table.phase = "lobby";
    setTimeout(()=>{ broadcastTable(); }, 200); // cập nhật lại UI về lobby
  }

  socket.on("disconnect", () => {
    // Nếu người chơi đang ngồi và chưa vào vòng chơi, cho rời ghế
    const s = seatBySocket(socket.id);
    if (s && (table.phase==="lobby" || table.phase==="betting")) {
      table.seats = table.seats.filter(x=>x.socketId!==socket.id);
    } else if (s) {
      // đang trong ván: giữ ghế nhưng đánh dấu done để không kẹt lượt
      s.done = true; s.turn = false;
      if (table.phase === "acting") {
        // nếu tất cả đã done -> qua dealer
        if (!table.seats.some(x=>x.cards?.length && !x.done)) {
          // đẩy qua dealer/payout
          while (handTotal(table.dealer) < 17) {
            table.dealer.push(dealCard());
          }
          table.phase = "payout";
          broadcastTable();
          settleAndSave();
        } else {
          // nếu người vừa rời là người đang đến lượt -> chuyến lượt
          nextTurn(); broadcastTable();
        }
      }
    }
    console.log("❌", socket.id, "disconnected");
  });

  // gửi state lần đầu
  socket.emit("tableState", safeState());
});

// ====== Routes ======
app.get("/health", (_,res)=>res.json({ ok: true, phase: table.phase }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=>console.log("🌐 Listening on", PORT));
