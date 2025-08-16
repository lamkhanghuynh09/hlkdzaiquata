const socket = io();

function joinGame(){
  const name = document.getElementById("name").value.trim();
  if(!name) return alert("Nhập tên!");
  socket.emit("joinGame", name);
}

socket.on("welcome", (data) => {
  document.getElementById("login").style.display="none";
  document.getElementById("game").style.display="block";
  document.getElementById("playerName").innerText=data.name;
  document.getElementById("playerChips").innerText=data.chips;
});

function placeBet(){
  const amount = Number(document.getElementById("betAmount").value);
  socket.emit("bet", amount);
}

socket.on("betPlaced", (data) => {
  const msg = document.createElement("div");
  msg.innerText = `${data.name} đã đặt cược ${data.amount} chip`;
  document.getElementById("messages").appendChild(msg);
});

socket.on("playerList", (list) => {
  const ul = document.getElementById("playerList");
  ul.innerHTML="";
  list.forEach(p=>{
    const li=document.createElement("li");
    li.innerText = `${p.name} (${p.chips} chip)`;
    ul.appendChild(li);
  });
});

socket.on("error", (msg) => alert(msg));
