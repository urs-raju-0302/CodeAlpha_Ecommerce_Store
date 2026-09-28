let products = [];
let cart = JSON.parse(localStorage.getItem("cart") || "[]");
let token = localStorage.getItem("token");
let currentUser = JSON.parse(localStorage.getItem("user") || "null");

const $ = (id) => document.getElementById(id);

function saveCart() {
  localStorage.setItem("cart", JSON.stringify(cart));
  updateCartCount();
}

function updateCartCount() {
  $("cartCount").textContent = cart.reduce((sum, item) => sum + item.quantity, 0);
}

function money(value) {
  return `₹${Number(value).toFixed(2)}`;
}

function toast(message) {
  $("toast").textContent = message;
  $("toast").style.display = "block";
  setTimeout(() => $("toast").style.display = "none", 2200);
}

function showSection(name) {
  document.querySelectorAll(".section").forEach(s => s.classList.add("hidden"));
  $(name).classList.remove("hidden");

  if (name === "cart") renderCart();
  if (name === "orders") loadOrders();
}

async function loadProducts() {
  const res = await fetch("/api/products");
  products = await res.json();
  $("productGrid").innerHTML = products.map(p => `
    <article class="card">
      <img src="${p.image}" alt="${p.name}">
      <div class="card-body">
        <h3>${p.name}</h3>
        <p>${p.description}</p>
        <div class="price">${money(p.price)}</div>
        <button class="secondary" onclick="viewProduct(${p.id})">View details</button>
        <button class="primary" onclick="addToCart(${p.id})">Add to cart</button>
      </div>
    </article>
  `).join("");
}

function viewProduct(id) {
  const p = products.find(x => x.id === id);
  $("productDetails").innerHTML = `
    <div class="details">
      <img src="${p.image}" alt="${p.name}">
      <div>
        <h2>${p.name}</h2>
        <p>${p.description}</p>
        <div class="price">${money(p.price)}</div>
        <button class="primary" onclick="addToCart(${p.id})">Add to cart</button>
      </div>
    </div>
  `;
  showSection("details");
}

function addToCart(id) {
  const existing = cart.find(x => x.productId === id);
  if (existing) existing.quantity++;
  else cart.push({ productId: id, quantity: 1 });
  saveCart();
  toast("Added to cart.");
}

function changeQuantity(id, amount) {
  const item = cart.find(x => x.productId === id);
  if (!item) return;
  item.quantity += amount;
  if (item.quantity <= 0) cart = cart.filter(x => x.productId !== id);
  saveCart();
  renderCart();
}

function renderCart() {
  if (!cart.length) {
    $("cartItems").innerHTML = "<p>Your cart is empty.</p>";
    $("cartSummary").innerHTML = "";
    return;
  }

  let total = 0;
  $("cartItems").innerHTML = cart.map(item => {
    const p = products.find(x => x.id === item.productId);
    const line = p.price * item.quantity;
    total += line;
    return `
      <div class="cart-row">
        <div>
          <strong>${p.name}</strong>
          <div>${money(p.price)} × ${item.quantity} = ${money(line)}</div>
        </div>
        <div>
          <button onclick="changeQuantity(${p.id}, -1)">−</button>
          <button onclick="changeQuantity(${p.id}, 1)">+</button>
        </div>
      </div>
    `;
  }).join("");

  $("cartSummary").innerHTML = `
    <div class="card-body">
      <h3>Total: ${money(total)}</h3>
      <button class="primary" onclick="placeOrder()">Place Order</button>
    </div>
  `;
}

async function placeOrder() {
  if (!token) {
    toast("Please login before placing an order.");
    showSection("auth");
    return;
  }

  const res = await fetch("/api/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({ items: cart })
  });

  const data = await res.json();
  if (!res.ok) return toast(data.message || "Order failed.");

  cart = [];
  saveCart();
  toast(`Order #${data.order.id} placed successfully.`);
  showSection("orders");
}

function toggleAuth(type) {
  $("loginForm").classList.toggle("hidden", type !== "login");
  $("registerForm").classList.toggle("hidden", type !== "register");
  $("authMessage").textContent = "";
}

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));

  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json();

  if (!res.ok) return $("authMessage").textContent = data.message;

  token = data.token;
  currentUser = data.user;
  localStorage.setItem("token", token);
  localStorage.setItem("user", JSON.stringify(currentUser));
  updateAuthUI();
  $("authMessage").textContent = "Login successful.";
});

$("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));

  const res = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json();

  if (!res.ok) return $("authMessage").textContent = data.message;

  token = data.token;
  currentUser = data.user;
  localStorage.setItem("token", token);
  localStorage.setItem("user", JSON.stringify(currentUser));
  updateAuthUI();
  $("authMessage").textContent = "Account created successfully.";
});

async function loadOrders() {
  if (!token) {
    $("ordersList").innerHTML = "<p>Please login to view your orders.</p>";
    return;
  }

  const res = await fetch("/api/orders", {
    headers: { "Authorization": `Bearer ${token}` }
  });
  const orders = await res.json();

  if (!orders.length) {
    $("ordersList").innerHTML = "<p>No orders yet.</p>";
    return;
  }

  $("ordersList").innerHTML = orders.map(o => `
    <div class="order">
      <strong>Order #${o.id}</strong>
      <p>Total: ${money(o.total)}</p>
      <small>${new Date(o.created_at).toLocaleString()}</small>
    </div>
  `).join("");
}

function updateAuthUI() {
  $("authButton").textContent = currentUser ? currentUser.name : "Login";
  $("logoutButton").classList.toggle("hidden", !currentUser);
}

function logout() {
  token = null;
  currentUser = null;
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  updateAuthUI();
  toast("Logged out.");
  showSection("products");
}

updateAuthUI();
updateCartCount();
loadProducts();
