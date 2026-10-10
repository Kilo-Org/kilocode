<!DOCTYPE html>
<html lang="en" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dashboard - Custom Site</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-[#121212] text-gray-200 font-sans flex h-screen overflow-hidden">

    <!-- Sidebar Navigation -->
    <aside class="w-20 bg-[#18181b] flex flex-col items-center py-6 border-r border-gray-800">
        <div class="text-orange-500 font-bold text-xl mb-10 bg-orange-500/10 p-2 rounded-xl">SL</div>
        <nav class="flex flex-col gap-6 text-gray-400">
            <a href="#" class="p-3 bg-orange-500/20 text-orange-500 rounded-xl">🏠</a>
            <a href="#" class="p-3 hover:text-white">📁</a>
            <a href="#" class="p-3 hover:text-white">💳</a>
            <a href="#" class="p-3 hover:text-white">✉️</a>
        </nav>
    </aside>

    <!-- Main Content Area -->
    <main class="flex-1 overflow-y-auto p-8">
        <!-- Top Bar -->
        <header class="flex justify-between items-center mb-8">
            <div class="text-sm bg-[#1e1e24] px-4 py-2 rounded-full border border-gray-800">
                Referred: <span class="text-white font-bold">0</span>
                <button class="ml-3 bg-orange-500 text-white text-xs px-3 py-1 rounded-full">Copy Ref Link</button>
            </div>
            <div class="flex items-center gap-4">
                <span class="bg-[#1e1e24] px-3 py-1 rounded-lg text-sm">0 pts</span>
                <div class="w-9 h-9 bg-orange-500 text-white rounded-full flex items-center justify-center font-bold">AN</div>
            </div>
        </header>

        <!-- Welcome Banner & Balance Card -->
        <section class="mb-8">
            <h1 class="text-2xl font-bold mb-4">Welcome back, <span class="text-orange-500">andyleexx010 👋</span></h1>
            
            <div class="bg-gradient-to-r from-orange-600 to-orange-500 p-8 rounded-3xl shadow-lg relative overflow-hidden">
                <p class="text-xs tracking-wider uppercase opacity-80 mb-1">TOTAL BALANCE</p>
                <h2 class="text-4xl font-extrabold mb-6">0 <span class="text-lg font-normal">pts</span></h2>
                <div class="flex gap-3">
                    <a href="#" class="bg-black/20 px-4 py-2 rounded-xl text-sm font-medium backdrop-blur-sm">Services →</a>
                    <a href="#" class="bg-black/20 px-4 py-2 rounded-xl text-sm font-medium backdrop-blur-sm">Orders 🛒</a>
                    <a href="#" class="bg-black/20 px-4 py-2 rounded-xl text-sm font-medium backdrop-blur-sm">History ⏱️</a>
                </div>
            </div>
        </section>

        <!-- Services Grid -->
        <section>
            <h3 class="text-lg font-semibold mb-4">All Services</h3>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div class="bg-[#18181b] p-5 rounded-2xl border border-gray-800 hover:border-orange-500 transition cursor-pointer">
                    <p class="font-medium">Crypto Receipts</p>
                </div>
                <div class="bg-[#18181b] p-5 rounded-2xl border border-gray-800 hover:border-orange-500 transition cursor-pointer">
                    <p class="font-medium">PayPal Generator</p>
                </div>
                <div class="bg-[#18181b] p-5 rounded-2xl border border-gray-800 hover:border-orange-500 transition cursor-pointer">
                    <p class="font-medium">Cash App Slips</p>
                </div>
                <div class="bg-[#18181b] p-5 rounded-2xl border border-gray-800 hover:border-orange-500 transition cursor-pointer">
                    <p class="font-medium">Wallet Tracker</p>
                </div>
            </div>
        </section>
    </main>

</body>
</html>
