const questions = [
  {
    question: "Trình là gì?",
    answers: ["ối ồi ôi", "HBao súc vật", "hồng trần trên cu ", "Thiên lý ơi"],
    correct: 1
  },
  {
    question: "Lâm Khang Dp Chai sinh ngày mấy?",
    answers: ["23", "9", "14", "10"],
    correct: 2
  },
  {
    question: "Lâm Khang Thích gì  ?",
    answers: ["Jack", "Bún Luộc", "Buns Cua", "Em❤️"],
    correct: 3
  }
];

let current = 0;
let score = 0;
let answered = false;

const questionEl = document.getElementById("question");
const answersEl = document.getElementById("answers");
const nextBtn = document.getElementById("next-btn");
const resultEl = document.getElementById("result");

function showQuestion() {
  answered = false;
  nextBtn.disabled = true;
  resultEl.classList.add("hidden");
  resultEl.textContent = "";

  let q = questions[current];
  questionEl.textContent = q.question;
  answersEl.innerHTML = "";

  q.answers.forEach((answer, index) => {
    let li = document.createElement("li");
    let btn = document.createElement("button");
    btn.textContent = answer;
    btn.onclick = () => checkAnswer(btn, index);
    li.appendChild(btn);
    answersEl.appendChild(li);
  });

  fadeIn(questionEl);
  fadeIn(answersEl);
}

function checkAnswer(button, index) {
  if (answered) return;
  answered = true;

  const correctIndex = questions[current].correct;
  const allButtons = answersEl.querySelectorAll("button");

  allButtons.forEach((btn, i) => {
    btn.disabled = true;

    if (i === correctIndex) {
      btn.style.backgroundColor = "#d4edda"; // xanh
      btn.style.borderColor = "#28a745";
      btn.innerHTML = "✓ " + btn.textContent;
    }

    if (i === index && index !== correctIndex) {
      btn.style.backgroundColor = "#f8d7da"; // đỏ
      btn.style.borderColor = "#dc3545";
      btn.innerHTML = "✗ " + btn.textContent;
    }
  });

  if (index === correctIndex) {
    score++;
    resultEl.classList.add("hidden");
  } else {
    resultEl.textContent = `Sai rồi! Đáp án đúng là:"${questions[current].answers[correctIndex]}"( Thấy chưa riêng thằng dog Hoàng Bảo là chỉ có súc vật bệnh hoạn biến thái hentai lắm mới trả lời sai câu hỏi của tao bởi vậy nói thk đó súc vật cực kì !!!`; 
    resultEl.style.color = "#dc3545";
    resultEl.classList.remove("hidden");
  }

  nextBtn.disabled = false;
}

function showResult() {
  document.getElementById("quiz").classList.add("hidden");
  resultEl.classList.remove("hidden");
  resultEl.style.color = "#28a745";
  resultEl.textContent = `Bạn đã trả lời đúng ( riêng thk 🐶Hoàng Bảo súc vật là hên may mắn hoặc được ông bà độ mới chọn đúng thôi)${score}/${questions.length} câu!`;
}

nextBtn.addEventListener("click", () => {
  current++;
  if (current < questions.length) {
    showQuestion();
  } else {
    showResult();
  }
});

function fadeIn(element) {
  element.classList.remove("fade-in");
  void element.offsetWidth;
  element.classList.add("fade-in");
}

showQuestion();