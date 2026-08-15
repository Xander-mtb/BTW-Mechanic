import express from 'express';
import session from 'express-session';

const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

router.use(
    session({
        secret: process.env.DASHBOARD_SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: process.env.NODE_ENV === 'production',
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000,
        },
    })
);

function escapeHtml(value = '') {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function getDiscordOAuthUrl() {
    const params = new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        response_type: 'code',
        redirect_uri: process.env.DISCORD_REDIRECT_URI,
        scope: 'identify guilds',
    });

    return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

/*
|--------------------------------------------------------------------------
| DASHBOARD HOME
|--------------------------------------------------------------------------
*/

router.get('/', async (req, res) => {
    const bot = req.app.locals.bot;

    let commandUsageTotal = 0;
    let topCommands = [];
    let commandUsageByDay = [];

    try {
        if (bot?.db) {
            const totalResult = await bot.db.query(`
                SELECT COUNT(*)::int AS count
                FROM command_usage
            `);

            commandUsageTotal = totalResult.rows[0]?.count ?? 0;

            const topCommandsResult = await bot.db.query(`
                SELECT
                    command_name,
                    COUNT(*)::int AS count
                FROM command_usage
                WHERE used_at >= NOW() - INTERVAL '14 days'
                GROUP BY command_name
                ORDER BY count DESC
                LIMIT 4
            `);

            topCommands = topCommandsResult.rows;

            const dailyResult = await bot.db.query(`
                SELECT
                    DATE(used_at) AS day,
                    COUNT(*)::int AS count
                FROM command_usage
                WHERE used_at >= CURRENT_DATE - INTERVAL '13 days'
                GROUP BY DATE(used_at)
                ORDER BY day ASC
            `);

            commandUsageByDay = dailyResult.rows;
        }
    } catch (error) {
        console.error('Dashboard command usage error:', error);
    }

    /*
    |--------------------------------------------------------------------------
    | LOGGED IN
    |--------------------------------------------------------------------------
    */

    if (req.session.user) {
        const user = req.session.user;

        const username = escapeHtml(
            user.global_name || user.username || 'User'
        );

        const userId = escapeHtml(user.id || '');

        const avatarUrl = user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
            : 'https://cdn.discordapp.com/embed/avatars/0.png';

        const serverCount = bot?.guilds?.cache?.size ?? 0;
        const botOnline = bot?.isReady() ?? false;
        const ping = bot?.ws?.ping;

        const userCount =
            bot?.guilds?.cache?.reduce(
                (total, guild) => total + (guild.memberCount ?? 0),
                0
            ) ?? 0;

        /*
        |--------------------------------------------------------------------------
        | COMMAND CHART DATA
        |--------------------------------------------------------------------------
        */

        const chartMax = Math.max(
            ...commandUsageByDay.map(
                row => Number(row.count) || 0
            ),
            1
        );

        const chartPoints = commandUsageByDay.map(
            (row, index) => {
                const x =
                    commandUsageByDay.length === 1
                        ? 400
                        : (index /
                              (commandUsageByDay.length - 1)) *
                          800;

                const count = Number(row.count) || 0;

                const y =
                    135 -
                    ((count / chartMax) * 110);

                return {
                    x,
                    y,
                };
            }
        );

        const chartLinePath = chartPoints.length
            ? `M${chartPoints
                  .map(point => `${point.x} ${point.y}`)
                  .join(' L')}`
            : 'M0 120 L800 120';

        const chartAreaPath = chartPoints.length
            ? `${chartLinePath} L800 150 L0 150 Z`
            : 'M0 120 L800 120 L800 150 L0 150 Z';

        const chartLastPoint =
            chartPoints.length
                ? chartPoints[chartPoints.length - 1]
                : { x: 0, y: 120 };

        return res.send(`
<!DOCTYPE html>
<html lang="en">

<head>

    <meta charset="UTF-8">

    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
    >

    <title>BTW Mechanic Dashboard</title>

    <style>

        * {
            box-sizing: border-box;
        }

        html {
            min-height: 100%;
        }

        body {
            margin: 0;
            min-height: 100vh;

            font-family:
                Arial,
                Helvetica,
                sans-serif;

            color: #ffffff;

            background:
                radial-gradient(
                    circle at 85% 0%,
                    rgba(91, 33, 182, 0.45) 0%,
                    rgba(37, 16, 79, 0.25) 28%,
                    transparent 55%
                ),
                #06060b;

            overflow-x: hidden;
        }

        a {
            color: inherit;
        }

        /* SIDEBAR */

        .sidebar {
            position: fixed;

            left: 0;
            top: 0;
            bottom: 0;

            width: 240px;

            display: flex;
            flex-direction: column;

            padding: 22px 14px 14px;

            background: rgba(8, 8, 15, 0.96);

            border-right: 1px solid #242438;

            z-index: 100;

            overflow-y: auto;
            overflow-x: hidden;
        }

        .brand {
            padding: 4px 10px 24px;
        }

        .brand-title {
            display: flex;
            align-items: center;

            gap: 9px;

            font-size: 19px;
            font-weight: 800;

            letter-spacing: -0.3px;
        }

        .brand-icon {
            color: #a855f7;
            font-size: 23px;
        }

        .brand-subtitle {
            margin-top: 3px;
            margin-left: 32px;

            color: #8b7ca8;

            font-size: 8px;
            font-weight: 800;

            letter-spacing: 1.2px;
        }

        .nav {
            display: flex;
            flex-direction: column;

            gap: 4px;
        }

        .nav a {
            display: flex;
            align-items: center;

            gap: 11px;

            padding: 10px 11px;

            color: #9692a7;

            text-decoration: none;

            font-size: 12px;
            font-weight: 600;

            border-radius: 7px;

            transition: 0.18s ease;
        }

        .nav a:hover {
            color: #ffffff;

            background: rgba(124, 58, 237, 0.12);
        }

        .nav a.active {
            color: #ffffff;

            background:
                linear-gradient(
                    90deg,
                    rgba(124, 58, 237, 0.28),
                    rgba(124, 58, 237, 0.08)
                );

            box-shadow:
                inset 2px 0 0 #8b5cf6,
                0 0 20px rgba(124, 58, 237, 0.12);
        }

        .nav-icon {
            width: 18px;

            text-align: center;

            font-size: 14px;
        }

        /* PROFILE */

        .profile {
            margin-top: auto;

            position: relative;
        }

        .profile-card {
            padding: 11px;

            border-radius: 13px;

            background: #1b2535;

            border: 1px solid #303c50;

            cursor: pointer;

            transition: 0.2s ease;
        }

        .profile-card:hover,
        .profile-card.open {
            border-color: #7c3aed;

            background: #202a3b;

            box-shadow:
                0 0 24px rgba(124, 58, 237, 0.15);
        }

        .profile-main {
            display: flex;
            align-items: center;

            gap: 10px;
        }

        .avatar {
            width: 38px;
            height: 38px;

            border-radius: 50%;

            object-fit: cover;

            border: 2px solid #4c1d95;

            background: #111827;
        }

        .profile-name {
            font-size: 13px;
            font-weight: 700;
        }

        .profile-status {
            margin-top: 3px;

            color: #858397;

            font-size: 10px;
        }

        .profile-status::before {
            content: "●";

            color: #22c55e;

            margin-right: 5px;
        }

        .profile-menu {
            display: none;

            margin-top: 10px;

            padding-top: 9px;

            border-top: 1px solid #30394a;
        }

        .profile-card.open .profile-menu {
            display: block;
        }

        .profile-id {
            padding: 4px 2px 9px;

            color: #8d8a9c;

            font-size: 10px;
        }

        .profile-id strong {
            display: block;

            margin-top: 4px;

            color: #d7d3e1;

            font-size: 10px;
        }

        .profile-menu a {
            display: block;

            padding: 8px 4px;

            color: #ffffff;

            text-decoration: none;

            font-size: 12px;

            border-radius: 6px;
        }

        .profile-menu a:hover {
            background: #29243b;
        }

        /* MAIN */

        .main {
            margin-left: 240px;

            min-height: 100vh;

            padding: 28px 34px 34px;
        }

        .topbar {
            display: flex;

            align-items: flex-start;

            justify-content: space-between;

            margin-bottom: 24px;
        }

        .page-title {
            margin: 0;

            font-size: 22px;
            font-weight: 800;

            letter-spacing: -0.5px;
        }

        .page-subtitle {
            margin: 5px 0 0;

            color: #858193;

            font-size: 11px;
        }

        .top-actions {
            display: flex;

            align-items: center;

            gap: 10px;
        }

        .bot-pill {
            display: flex;

            align-items: center;

            gap: 8px;

            padding: 8px 12px;

            background: #11111c;

            border: 1px solid #29243b;

            border-radius: 7px;

            color: #a6a0b5;

            font-size: 10px;
        }

        .bot-pill .dot {
            width: 6px;
            height: 6px;

            border-radius: 50%;

            background:
                ${botOnline ? '#22c55e' : '#ef4444'};

            box-shadow:
                0 0 8px
                ${botOnline
                    ? 'rgba(34,197,94,.7)'
                    : 'rgba(239,68,68,.7)'};
        }

        .invite-btn {
            padding: 9px 14px;

            color: #ffffff;

            text-decoration: none;

            background:
                linear-gradient(
                    135deg,
                    #7c3aed,
                    #6d28d9
                );

            border: 1px solid #8b5cf6;

            border-radius: 7px;

            font-size: 10px;
            font-weight: 700;

            box-shadow:
                0 0 18px rgba(124, 58, 237, 0.25);

            transition: 0.2s ease;
        }

        .invite-btn:hover {
            transform: translateY(-1px);

            box-shadow:
                0 0 25px rgba(124, 58, 237, 0.45);
        }

        /* STATISTICS */

        .stats {
            display: grid;

            grid-template-columns:
                repeat(4, minmax(0, 1fr));

            gap: 12px;

            margin-bottom: 12px;
        }

        .stat {
            min-height: 92px;

            padding: 14px;

            background: #0d0d16;

            border: 1px solid #211a34;

            border-radius: 9px;

            box-shadow:
                0 8px 28px rgba(76, 29, 149, 0.08);
        }

        .stat-top {
            display: flex;

            justify-content: space-between;

            align-items: center;
        }

        .stat-label {
            color: #8e899f;

            font-size: 10px;
        }

        .stat-icon {
            color: #a855f7;

            font-size: 14px;
        }

        .stat-value {
            margin-top: 7px;

            font-size: 18px;

            font-weight: 800;
        }

        .stat-change {
            margin-top: 5px;

            color: #22c55e;

            font-size: 8px;
        }

        /* PANELS */

        .dashboard-grid {
            display: grid;

            grid-template-columns:
                minmax(0, 1.8fr)
                minmax(280px, 0.8fr);

            gap: 12px;
        }

        .panel {
            background: #0d0d16;

            border: 1px solid #211a34;

            border-radius: 9px;

            overflow: hidden;
        }

        .panel-header {
            display: flex;

            justify-content: space-between;

            align-items: center;

            padding: 13px 14px;

            border-bottom: 1px solid #191525;
        }

        .panel-title {
            font-size: 11px;

            font-weight: 700;
        }

        .panel-subtitle {
            margin-top: 3px;

            color: #696477;

            font-size: 8px;
        }

        .panel-body {
            padding: 14px;
        }

        .period {
            padding: 6px 8px;

            color: #aaa5b6;

            background: #12111d;

            border: 1px solid #28223a;

            border-radius: 5px;

            font-size: 8px;
        }

        /* CHART */

        .chart {
            height: 235px;

            position: relative;

            background:
                linear-gradient(
                    rgba(255,255,255,.035) 1px,
                    transparent 1px
                ),
                linear-gradient(
                    90deg,
                    rgba(255,255,255,.025) 1px,
                    transparent 1px
                );

            background-size:
                100% 47px,
                54px 100%;

            border-radius: 6px;

            overflow: hidden;
        }

        .chart-line {
            position: absolute;

            left: 2%;
            right: 2%;

            bottom: 42px;

            height: 125px;
        }

        .chart-line svg {
            width: 100%;
            height: 100%;

            overflow: visible;
        }

        .chart-area {
            fill: url(#areaGradient);
        }

        .chart-path {
            fill: none;

            stroke: #8b5cf6;

            stroke-width: 2.5;

            filter:
                drop-shadow(
                    0 0 5px rgba(139,92,246,.55)
                );
        }

        .chart-dot {
            fill: #c084fc;

            stroke: #ffffff;

            stroke-width: 1;
        }

        .chart-labels {
            position: absolute;

            left: 12px;
            right: 12px;

            bottom: 10px;

            display: flex;

            justify-content: space-between;

            color: #5f5a6d;

            font-size: 8px;
        }

        /* ACTIVITY */

        .activity-list {
            display: flex;

            flex-direction: column;
        }

        .activity {
            display: flex;

            align-items: center;

            gap: 10px;

            padding: 11px 0;

            border-bottom: 1px solid #181522;
        }

        .activity:last-child {
            border-bottom: 0;
        }

        .activity-icon {
            width: 28px;
            height: 28px;

            display: grid;

            place-items: center;

            flex-shrink: 0;

            border-radius: 7px;

            background: #171226;

            color: #a855f7;
        }

        .activity-text {
            min-width: 0;
        }

        .activity-title {
            font-size: 9px;

            font-weight: 600;
        }

        .activity-meta {
            margin-top: 3px;

            color: #666174;

            font-size: 8px;
        }

        .activity-time {
            margin-left: auto;

            color: #5e596a;

            font-size: 8px;
        }

        /* LOWER GRID */

        .lower-grid {
            display: grid;

            grid-template-columns:
                1fr 1fr 1fr;

            gap: 12px;

            margin-top: 12px;
        }

        .command {
            display: grid;

            grid-template-columns:
                20px 1fr 70px;

            align-items: center;

            gap: 8px;

            margin-bottom: 11px;
        }

        .command:last-child {
            margin-bottom: 0;
        }

        .command-rank {
            color: #777083;

            font-size: 9px;
        }

        .command-name {
            font-size: 9px;

            font-weight: 600;
        }

        .command-bar {
            height: 4px;

            margin-top: 5px;

            background: #1b1725;

            border-radius: 5px;

            overflow: hidden;
        }

        .command-bar span {
            display: block;

            height: 100%;

            background:
                linear-gradient(
                    90deg,
                    #7c3aed,
                    #a855f7
                );

            border-radius: inherit;
        }

        .command-count {
            text-align: right;

            color: #777083;

            font-size: 8px;
        }

        /* DISTRIBUTION */

        .distribution {
            display: flex;

            align-items: center;

            gap: 18px;

            min-height: 145px;
        }

        .donut {
            width: 104px;
            height: 104px;

            flex-shrink: 0;

            border-radius: 50%;

            background:
                conic-gradient(
                    #8b5cf6 0 42%,
                    #a855f7 42% 66%,
                    #38bdf8 66% 83%,
                    #ec4899 83% 100%
                );

            position: relative;
        }

        .donut::after {
            content: "${serverCount}";

            position: absolute;

            inset: 20px;

            display: grid;

            place-items: center;

            border-radius: 50%;

            background: #0d0d16;

            color: #ffffff;

            font-size: 16px;

            font-weight: 800;
        }

        .legend {
            display: flex;

            flex-direction: column;

            gap: 10px;
        }

        .legend-item {
            display: flex;

            align-items: center;

            gap: 7px;

            color: #858091;

            font-size: 8px;
        }

        .legend-dot {
            width: 7px;
            height: 7px;

            border-radius: 50%;
        }

        /* SYSTEM STATUS */

        .system-row {
            display: flex;

            align-items: center;

            padding: 10px 0;

            border-bottom: 1px solid #181522;
        }

        .system-row:last-child {
            border-bottom: 0;
        }

        .system-name {
            color: #a8a3b3;

            font-size: 9px;
        }

        .system-status {
            margin-left: auto;

            color: #22c55e;

            font-size: 8px;
        }

        .system-status::before {
            content: "●";

            margin-right: 5px;
        }

        /* FOOTER */

        .footer {
            display: grid;

            grid-template-columns:
                repeat(3, 1fr);

            gap: 12px;

            margin-top: 12px;

            padding: 11px 14px;

            background: #0d0d16;

            border: 1px solid #211a34;

            border-radius: 9px;
        }

        .footer-item {
            display: flex;

            align-items: center;

            gap: 8px;
        }

        .footer-label {
            color: #686273;

            font-size: 8px;
        }

        .footer-value {
            margin-left: auto;

            color: #bcb7c7;

            font-size: 8px;

            font-weight: 700;
        }

        /* MOBILE */

        @media (max-width: 1000px) {
            .stats {
                grid-template-columns:
                    repeat(2, 1fr);
            }

            .dashboard-grid {
                grid-template-columns: 1fr;
            }

            .lower-grid {
                grid-template-columns: 1fr;
            }
        }

        @media (max-width: 720px) {
            .sidebar {
                position: relative;

                width: 100%;

                height: auto;

                min-height: auto;
            }

            .profile {
                margin-top: 20px;
            }

            .main {
                margin-left: 0;

                padding: 22px 16px;
            }

            .topbar {
                flex-direction: column;

                gap: 14px;
            }

            .stats {
                grid-template-columns: 1fr;
            }
        }

    </style>

</head>

<body>

    <aside class="sidebar">

        <div class="brand">

            <div class="brand-title">

                <span class="brand-icon">
                    ⚙
                </span>

                <span>
                    BTW Mechanic
                </span>

            </div>

            <div class="brand-subtitle">
                DISCORD BOT
            </div>

        </div>

        <nav class="nav">

            <a
                href="/dashboard"
                class="active"
            >
                <span class="nav-icon">⌂</span>
                Dashboard
            </a>

            <a href="/dashboard">
                <span class="nav-icon">♙</span>
                Servers
            </a>

            <a href="/dashboard">
                <span class="nav-icon">♙</span>
                Users
            </a>

            <a href="/dashboard">
                <span class="nav-icon">⌘</span>
                Commands
            </a>

            <a href="/dashboard">
                <span class="nav-icon">◈</span>
                Moderation
            </a>

            <a href="/dashboard">
                <span class="nav-icon">▱</span>
                Tickets
            </a>

            <a href="/dashboard">
                <span class="nav-icon">♢</span>
                Giveaways
            </a>

            <a href="/dashboard">
                <span class="nav-icon">♫</span>
                Music
            </a>

            <a href="/dashboard">
                <span class="nav-icon">◌</span>
                Logging
            </a>

            <a href="/dashboard">
                <span class="nav-icon">⚙</span>
                Settings
            </a>

        </nav>

        <div class="profile">

            <div
                class="profile-card"
                id="profileCard"
                onclick="toggleProfile(event)"
            >

                <div class="profile-main">

                    <img
                        class="avatar"
                        src="${escapeHtml(avatarUrl)}"
                        alt="Discord avatar"
                    >

                    <div>

                        <div class="profile-name">
                            ${username}
                        </div>

                        <div class="profile-status">
                            Online
                        </div>

                    </div>

                </div>

                <div class="profile-menu">

                    <div class="profile-id">

                        Discord ID

                        <strong>
                            ${userId}
                        </strong>

                    </div>

                    <a href="/dashboard">
                        ⚙️ Settings
                    </a>

                    <a href="/dashboard/logout">
                        🚪 Log out
                    </a>

                </div>

            </div>

        </div>

    </aside>

    <main class="main">

        <div class="topbar">

            <div>

                <h1 class="page-title">
                    Dashboard
                </h1>

                <p class="page-subtitle">
                    Overview of your bot's performance and activity.
                </p>

            </div>

            <div class="top-actions">

                <div class="bot-pill">

                    <span class="dot"></span>

                    Bot Status

                    <strong>
                        ${botOnline ? 'Online' : 'Offline'}
                    </strong>

                </div>

                <a
                    class="invite-btn"
                    href="/dashboard"
                >
                    💬 Invite Bot
                </a>

            </div>

        </div>

        <section class="stats">

            <div class="stat">

                <div class="stat-top">

                    <span class="stat-label">
                        Servers
                    </span>

                    <span class="stat-icon">
                        ♙
                    </span>

                </div>

                <div class="stat-value">
                    ${serverCount}
                </div>

                <div class="stat-change">
                    ● Connected
                </div>

            </div>

            <div class="stat">

                <div class="stat-top">

                    <span class="stat-label">
                        Users
                    </span>

                    <span class="stat-icon">
                        ♙
                    </span>

                </div>

                <div class="stat-value">
                    ${userCount.toLocaleString()}
                </div>

                <div class="stat-change">
                    Total members
                </div>

            </div>

            <div class="stat">

                <div class="stat-top">

                    <span class="stat-label">
                        Messages
                    </span>

                    <span class="stat-icon">
                        ●
                    </span>

                </div>

                <div class="stat-value">
                    ${userCount.toLocaleString()}
                </div>

                <div class="stat-change">
                    Total members
                </div>

            </div>

            <div class="stat">

                <div class="stat-top">

                    <span class="stat-label">
                        Commands Used
                    </span>

                    <span class="stat-icon">
                        &lt;/&gt;
                    </span>

                </div>

                <div class="stat-value">
                    ${commandUsageTotal.toLocaleString()}
                </div>

                <div class="stat-change">
                    Total commands
                </div>

            </div>

        </section>

        <section class="dashboard-grid">

            <div class="panel">

                <div class="panel-header">

                    <div>

                        <div class="panel-title">
                            Command Usage
                        </div>

                        <div class="panel-subtitle">
                            Total commands used over the last 14 days
                        </div>

                    </div>

                    <div class="period">
                        Last 14 Days
                    </div>

                </div>

                <div class="panel-body">

                    <div class="chart">

                        <div class="chart-line">

                            <svg
                                viewBox="0 0 800 150"
                                preserveAspectRatio="none"
                            >

                                <defs>

                                    <linearGradient
                                        id="areaGradient"
                                        x1="0"
                                        x2="0"
                                        y1="0"
                                        y2="1"
                                    >

                                        <stop
                                            offset="0%"
                                            stop-color="#8b5cf6"
                                            stop-opacity=".30"
                                        />

                                        <stop
                                            offset="100%"
                                            stop-color="#8b5cf6"
                                            stop-opacity="0"
                                        />

                                    </linearGradient>

                                </defs>

                                <path
                                    class="chart-area"
                                    d="${chartAreaPath}"
                                />

                                <path
                                    class="chart-path"
                                    d="${chartLinePath}"
                                />

                                <circle
                                    class="chart-dot"
                                    cx="${chartLastPoint.x}"
                                    cy="${chartLastPoint.y}"
                                    r="4"
                                />

                            </svg>

                        </div>

                        <div class="chart-labels">

                            <span>Aug 1</span>
                            <span>Aug 3</span>
                            <span>Aug 5</span>
                            <span>Aug 7</span>
                            <span>Aug 9</span>
                            <span>Aug 11</span>

                        </div>

                    </div>

                </div>

            </div>

            <div class="panel">

                <div class="panel-header">

                    <div class="panel-title">
                        Recent Activity
                    </div>

                    <div class="period">
                        Live
                    </div>

                </div>

                <div class="panel-body">

                    <div class="activity-list">

                        <div class="activity">

                            <div class="activity-icon">
                                ♙
                            </div>

                            <div class="activity-text">

                                <div class="activity-title">
                                    Bot status checked
                                </div>

                                <div class="activity-meta">
                                    Discord gateway
                                </div>

                            </div>

                            <div class="activity-time">
                                now
                            </div>

                        </div>

                        <div class="activity">

                            <div class="activity-icon">
                                &lt;/&gt;
                            </div>

                            <div class="activity-text">

                                <div class="activity-title">
                                    Dashboard loaded
                                </div>

                                <div class="activity-meta">
                                    Web dashboard
                                </div>

                            </div>

                            <div class="activity-time">
                                now
                            </div>

                        </div>

                        <div class="activity">

                            <div class="activity-icon">
                                🔐
                            </div>

                            <div class="activity-text">

                                <div class="activity-title">
                                    User authenticated
                                </div>

                                <div class="activity-meta">
                                    Discord OAuth
                                </div>

                            </div>

                            <div class="activity-time">
                                now
                            </div>

                        </div>

                    </div>

                </div>

            </div>

        </section>

        <section class="lower-grid">

            <div class="panel">

                <div class="panel-header">

                    <div class="panel-title">
                        ⭐ Top Commands
                    </div>

                    <div class="period">
                        View All
                    </div>

                </div>

                <div class="panel-body">

                    ${
                        topCommands.length
                            ? topCommands
                                  .map(
                                      (command, index) => `
                        <div class="command">

                            <span class="command-rank">
                                ${index + 1}.
                            </span>

                            <div>

                                <div class="command-name">
                                    /${escapeHtml(
                                        command.command_name
                                    )}
                                </div>

                                <div class="command-bar">

                                    <span
                                        style="width: ${Math.max(
                                            10,
                                            (Number(
                                                command.count
                                            ) /
                                                Math.max(
                                                    Number(
                                                        topCommands[0]
                                                            ?.count
                                                    ) || 1,
                                                    1
                                                )) *
                                                100
                                        )}%"
                                    ></span>

                                </div>

                            </div>

                            <span class="command-count">
                                ${Number(
                                    command.count
                                ).toLocaleString()}
                            </span>

                        </div>
                    `
                                  )
                                  .join('')
                            : `
                        <div class="command">

                            <span class="command-rank">
                                —
                            </span>

                            <div>

                                <div class="command-name">
                                    No command usage yet
                                </div>

                                <div class="command-bar">
                                    <span style="width: 10%"></span>
                                </div>

                            </div>

                            <span class="command-count">
                                0
                            </span>

                        </div>
                    `
                    }

                </div>

            </div>

            <div class="panel">

                <div class="panel-header">

                    <div class="panel-title">
                        🌐 Server Distribution
                    </div>

                </div>

                <div class="panel-body">

                    <div class="distribution">

                        <div class="donut"></div>

                        <div class="legend">

                            <div class="legend-item">

                                <span
                                    class="legend-dot"
                                    style="background:#8b5cf6"
                                ></span>

                                Community

                            </div>

                            <div class="legend-item">

                                <span
                                    class="legend-dot"
                                    style="background:#a855f7"
                                ></span>

                                Gaming

                            </div>

                            <div class="legend-item">

                                <span
                                    class="legend-dot"
                                    style="background:#38bdf8"
                                ></span>

                                Music

                            </div>

                            <div class="legend-item">

                                <span
                                    class="legend-dot"
                                    style="background:#ec4899"
                                ></span>

                                Other

                            </div>

                        </div>

                    </div>

                </div>

            </div>

            <div class="panel">

                <div class="panel-header">

                    <div class="panel-title">
                        🛡 System Status
                    </div>

                </div>

                <div class="panel-body">

                    <div class="system-row">

                        <span class="system-name">
                            ⚙ API
                        </span>

                        <span class="system-status">
                            Operational
                        </span>

                    </div>

                    <div class="system-row">

                        <span class="system-name">
                            ▣ Database
                        </span>

                        <span class="system-status">
                            Operational
                        </span>

                    </div>

                    <div class="system-row">

                        <span class="system-name">
                            ▤ Web Dashboard
                        </span>

                        <span class="system-status">
                            Operational
                        </span>

                    </div>

                    <div class="system-row">

                        <span class="system-name">
                            ♫ Music System
                        </span>

                        <span class="system-status">
                            Operational
                        </span>

                    </div>

                </div>

            </div>

        </section>

        <footer class="footer">

            <div class="footer-item">

                <span class="footer-label">
                    CPU Usage
                </span>

                <span class="footer-value">
                    —
                </span>

            </div>

            <div class="footer-item">

                <span class="footer-label">
                    Memory Usage
                </span>

                <span class="footer-value">
                    —
                </span>

            </div>

            <div class="footer-item">

                <span class="footer-label">
                    Ping
                </span>

                <span class="footer-value">

                    ${
                        typeof ping === 'number'
                            ? `${ping}ms`
                            : '—'
                    }

                </span>

            </div>

        </footer>

    </main>

    <script>

        function toggleProfile(event) {

            if (event) {
                event.stopPropagation();
            }

            const card =
                document.getElementById('profileCard');

            if (card) {
                card.classList.toggle('open');
            }

        }

        document.addEventListener(
            'click',
            function (event) {

                const card =
                    document.getElementById(
                        'profileCard'
                    );

                if (!card) {
                    return;
                }

                if (!card.contains(event.target)) {
                    card.classList.remove('open');
                }

            }
        );

    </script>

</body>

</html>
        `);
    }

    /*
    |--------------------------------------------------------------------------
    | NOT LOGGED IN
    |--------------------------------------------------------------------------
    */

    return res.send(`
<!DOCTYPE html>

<html lang="en">

<head>

    <meta charset="UTF-8">

    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
    >

    <title>BTW Mechanic</title>

    <style>

        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;

            min-height: 100vh;

            display: flex;

            align-items: center;
            justify-content: center;

            font-family:
                Arial,
                Helvetica,
                sans-serif;

            color: white;

            background:
                radial-gradient(
                    circle at top right,
                    #24104f 0%,
                    #090910 45%,
                    #050509 100%
                );
        }

        .login-card {
            width: 90%;

            max-width: 500px;

            padding: 45px;

            text-align: center;

            background:
                rgba(15, 15, 30, 0.85);

            border:
                1px solid #2a1748;

            border-radius: 16px;

            box-shadow:
                0 8px 35px
                rgba(124, 58, 237, 0.22);
        }

        .logo {
            font-size: 60px;
        }

        h1 {
            margin-bottom: 10px;
        }

        p {
            color: #9ca3af;

            line-height: 1.6;
        }

        .login {
            display: inline-block;

            margin-top: 20px;

            padding: 14px 28px;

            background: #5865F2;

            color: white;

            text-decoration: none;

            border-radius: 8px;

            font-weight: bold;
        }

        .login:hover {
            background: #4752c4;
        }

    </style>

</head>

<body>

    <div class="login-card">

        <div class="logo">
            ⚙️
        </div>

        <h1>
            BTW Mechanic
        </h1>

        <p>
            Manage your Discord bot from one simple dashboard.
        </p>

        <a
            class="login"
            href="/dashboard/auth/discord"
        >
            Login with Discord
        </a>

    </div>

</body>

</html>
    `);
});

/*
|--------------------------------------------------------------------------
| DISCORD OAUTH
|--------------------------------------------------------------------------
*/

router.get('/auth/discord', (req, res) => {
    res.redirect(getDiscordOAuthUrl());
});

router.get(
    '/auth/discord/callback',
    async (req, res) => {

        try {

            const { code } = req.query;

            if (!code) {
                return res
                    .status(400)
                    .send(
                        'Missing Discord authorization code.'
                    );
            }

            const tokenResponse = await fetch(
                'https://discord.com/api/oauth2/token',
                {
                    method: 'POST',

                    headers: {
                        'Content-Type':
                            'application/x-www-form-urlencoded',
                    },

                    body: new URLSearchParams({

                        client_id:
                            process.env.DISCORD_CLIENT_ID,

                        client_secret:
                            process.env.DISCORD_CLIENT_SECRET,

                        grant_type:
                            'authorization_code',

                        code: String(code),

                        redirect_uri:
                            process.env.DISCORD_REDIRECT_URI,

                    }),
                }
            );

            const tokenData =
                await tokenResponse.json();

            if (!tokenResponse.ok) {

                console.error(
                    'Discord OAuth token error:',
                    tokenData
                );

                return res
                    .status(500)
                    .send(
                        'Discord login failed.'
                    );
            }

            const userResponse = await fetch(
                'https://discord.com/api/users/@me',
                {
                    headers: {
                        Authorization:
                            `${tokenData.token_type} ${tokenData.access_token}`,
                    },
                }
            );

            const user =
                await userResponse.json();

            if (!userResponse.ok) {

                console.error(
                    'Discord user error:',
                    user
                );

                return res
                    .status(500)
                    .send(
                        'Discord login failed while getting your user information.'
                    );
            }

            req.session.user = user;

            return res.redirect('/dashboard');

        } catch (error) {

            console.error(
                'Discord OAuth error:',
                error
            );

            return res
                .status(500)
                .send(
                    'Something went wrong while logging in with Discord.'
                );
        }

    }
);

/*
|--------------------------------------------------------------------------
| LOGOUT
|--------------------------------------------------------------------------
*/

router.get('/logout', (req, res) => {

    req.session.destroy(() => {
        res.redirect('/dashboard');
    });

});

export default router;