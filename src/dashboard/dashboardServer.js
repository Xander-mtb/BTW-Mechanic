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

    /*
    |--------------------------------------------------------------------------
    | COMMAND USAGE PERIOD
    |--------------------------------------------------------------------------
    */

    const commandDays =
        [7, 14, 30].includes(Number(req.query.commandDays))
            ? Number(req.query.commandDays)
            : 14;

    const selectedPeriod = commandDays;

    const periodLabel =
        selectedPeriod === 7
            ? 'Last 7 Days'
            : selectedPeriod === 30
                ? 'Last 1 Month'
                : 'Last 14 Days';

    let commandUsageTotal = 0;
    let topCommands = [];
    let commandUsageByDay = [];

    try {
        if (bot?.db?.db?.pool) {

            /*
            |--------------------------------------------------------------------------
            | TOTAL COMMAND USAGE
            |--------------------------------------------------------------------------
            */

            const totalResult = await bot.db.db.pool.query(`
                SELECT COUNT(*)::int AS count
                FROM command_usage
            `);

            commandUsageTotal =
                totalResult.rows[0]?.count ?? 0;

            /*
            |--------------------------------------------------------------------------
            | TOP COMMANDS
            |--------------------------------------------------------------------------
            */

            const topCommandsResult =
                await bot.db.db.pool.query(`
                    SELECT
                        command_name,
                        COUNT(*)::int AS count
                    FROM command_usage
                    WHERE used_at >= NOW() - INTERVAL '14 days'
                    GROUP BY command_name
                    ORDER BY count DESC
                    LIMIT 4
                `);

            topCommands =
                topCommandsResult.rows;

            /*
            |--------------------------------------------------------------------------
            | COMMAND USAGE GRAPH
            |--------------------------------------------------------------------------
            */

            const dailyResult =
                await bot.db.db.pool.query(`
                    WITH days AS (
                        SELECT generate_series(
                            CURRENT_DATE - ($1::int - 1),
                            CURRENT_DATE,
                            INTERVAL '1 day'
                        )::date AS day
                    ),
                    usage AS (
                        SELECT
                            DATE(used_at) AS day,
                            COUNT(*)::int AS count
                        FROM command_usage
                        WHERE used_at >= CURRENT_DATE - ($1::int - 1)
                        GROUP BY DATE(used_at)
                    )
                    SELECT
                        days.day,
                        COALESCE(usage.count, 0)::int AS count
                    FROM days
                    LEFT JOIN usage
                        ON usage.day = days.day
                    ORDER BY days.day ASC
                `,
                [commandDays]);

            commandUsageByDay =
                dailyResult.rows;
        }

    } catch (error) {

        console.error(
            'Dashboard command usage error:',
            error
        );
    }

    /*
    |--------------------------------------------------------------------------
    | LOGGED IN
    |--------------------------------------------------------------------------
    */

    if (req.session.user) {

        const user =
            req.session.user;

        const username =
            escapeHtml(
                user.global_name ||
                user.username ||
                'User'
            );

        const userId =
            escapeHtml(
                user.id || ''
            );

        const avatarUrl =
            user.avatar
                ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
                : 'https://cdn.discordapp.com/embed/avatars/0.png';

        const serverCount =
            bot?.guilds?.cache?.size ?? 0;

        const botOnline =
            bot?.isReady() ?? false;

        const ping =
            bot?.ws?.ping;

        const userCount =
            bot?.guilds?.cache?.reduce(
                (total, guild) =>
                    total + (guild.memberCount ?? 0),
                0
            ) ?? 0;

            const messageCount =
    await bot.db.db.pool.query(
        'SELECT COALESCE(SUM(message_count), 0) AS total FROM message_stats'
    ).then(result => Number(result.rows[0]?.total ?? 0))
     .catch(() => 0);

        /*
        |--------------------------------------------------------------------------
        | COMMAND CHART DATA
        |--------------------------------------------------------------------------
        */

        const chartMax =
            Math.max(
                ...commandUsageByDay.map(
                    row =>
                        Number(row.count) || 0
                ),
                1
            );

        const chartPoints =
            commandUsageByDay.map(
                (row, index) => {

                    const x =
                        commandUsageByDay.length === 1
                            ? 400
                            : (
                                index /
                                (
                                    commandUsageByDay.length - 1
                                )
                            ) * 800;

                    const count =
                        Number(row.count) || 0;

                    const y =
                        135 -
                        (
                            (count / chartMax) *
                            110
                        );

                    return {
                        x,
                        y,
                    };
                }
            );

        const chartLinePath =
            chartPoints.length
                ? `M${chartPoints
                    .map(
                        point =>
                            `${point.x} ${point.y}`
                    )
                    .join(' L')}`
                : 'M0 120 L800 120';

        const chartAreaPath =
            chartPoints.length
                ? `${chartLinePath} L800 150 L0 150 Z`
                : 'M0 120 L800 120 L800 150 L0 150 Z';

        const chartLastPoint =
            chartPoints.length
                ? chartPoints[
                    chartPoints.length - 1
                ]
                : {
                    x: 0,
                    y: 120,
                };

        /*
        |--------------------------------------------------------------------------
        | DASHBOARD HTML
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

            background: rgba(
                124,
                58,
                237,
                0.12
            );
        }

        .nav a.active {
            color: #ffffff;

            background:
                linear-gradient(
                    90deg,
                    rgba(
                        124,
                        58,
                        237,
                        0.28
                    ),
                    rgba(
                        124,
                        58,
                        237,
                        0.08
                    )
                );

            box-shadow:
                inset 2px 0 0 #8b5cf6,
                0 0 20px
                rgba(
                    124,
                    58,
                    237,
                    0.12
                );
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
                0 0 24px
                rgba(
                    124,
                    58,
                    237,
                    0.15
                );
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

        .profile-card.open
        .profile-menu {
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
                ${botOnline
                    ? '#22c55e'
                    : '#ef4444'};

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
                0 0 18px
                rgba(
                    124,
                    58,
                    237,
                    0.25
                );

            transition: 0.2s ease;
        }

        .invite-btn:hover {
            transform: translateY(-1px);

            box-shadow:
                0 0 25px
                rgba(
                    124,
                    58,
                    237,
                    0.45
                );
        }

        /* STATISTICS */

        .stats {
            display: grid;

            grid-template-columns:
                repeat(
                    4,
                    minmax(0, 1fr)
                );

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
                0 8px 28px
                rgba(
                    76,
                    29,
                    149,
                    0.08
                );
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

            cursor: pointer;

            outline: none;
        }

        .period:hover {
            border-color: #7c3aed;
        }

        .period:focus {
            border-color: #8b5cf6;

            box-shadow:
                0 0 0 2px
                rgba(
                    139,
                    92,
                    246,
                    0.15
                );
        }

        .period option {
            background: #12111d;

            color: #ffffff;
        }

        /* CHART */

        .chart {
            height: 235px;

            position: relative;

            background:
                linear-gradient(
                    rgba(
                        255,
                        255,
                        255,
                        .035
                    ) 1px,
                    transparent 1px
                ),
                linear-gradient(
                    90deg,
                    rgba(
                        255,
                        255,
                        255,
                        .025
                    ) 1px,
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
                    0 0 5px
                    rgba(
                        139,
                        92,
                        246,
                        .55
                    )
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
                    Total Users
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
                    ${messageCount.toLocaleString()}
                </div>

                <div class="stat-change">
                    Total messages
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
                            Total commands used over the selected period
                        </div>

                    </div>

                    <select
                        class="period"
                        id="commandPeriod"
                        onchange="changeCommandPeriod(this.value)"
                    >

                        <option
                            value="7"
                            ${selectedPeriod === 7 ? 'selected' : ''}
                        >
                            Last 7 Days
                        </option>

                        <option
                            value="14"
                            ${selectedPeriod === 14 ? 'selected' : ''}
                        >
                            Last 14 Days
                        </option>

                        <option
                            value="30"
                            ${selectedPeriod === 30 ? 'selected' : ''}
                        >
                            Last 1 Month
                        </option>

                    </select>

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

                            ${commandUsageByDay
                                .map(row => {

                                    const date =
                                        new Date(
                                            row.day
                                        );

                                    return `
                                        <span>
                                            ${date.toLocaleDateString(
                                                'en-GB',
                                                {
                                                    day: 'numeric',
                                                    month: 'short'
                                                }
                                            )}
                                        </span>
                                    `;

                                })
                                .join('')}

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
                                            (
                                                Number(
                                                    command.count
                                                ) /
                                                Math.max(
                                                    Number(
                                                        topCommands[0]
                                                            ?.count
                                                    ) || 1,
                                                    1
                                                )
                                            ) * 100
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
                document.getElementById(
                    'profileCard'
                );

            if (card) {
                card.classList.toggle('open');
            }

        }

        function changeCommandPeriod(days) {

            const url =
                new URL(
                    window.location.href
                );

            url.searchParams.set(
                'commandDays',
                days
            );

            window.location.href =
                url.toString();

        }

        setInterval(() => {
    window.location.reload();
}, 10000);

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
| NOT LOGGED IN - LANDING PAGE
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

    <meta
        name="description"
        content="BTW Mechanic — Serving the Beyond Two Wheels Community, one crank at a time."
    >

    <title>BTW Mechanic | Beyond Two Wheels</title>

    <style>

        * {
            box-sizing: border-box;
        }

        html {
            scroll-behavior: smooth;
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

        body::before {
            content: "";

            position: fixed;

            inset: 0;

            pointer-events: none;

            background:
                radial-gradient(
                    circle at 15% 35%,
                    rgba(124, 58, 237, 0.06),
                    transparent 30%
                );

            z-index: -1;
        }

        a {
            color: inherit;

            text-decoration: none;
        }

        /* =========================================================
           NAVIGATION
        ========================================================= */

        .navbar {
            position: fixed;

            top: 0;
            left: 0;
            right: 0;

            z-index: 100;

            padding: 18px 6%;

            background:
                rgba(6, 6, 11, 0.72);

            backdrop-filter: blur(18px);

            border-bottom:
                1px solid
                rgba(139, 92, 246, 0.08);
        }

        .navbar-inner {
            max-width: 1250px;

            margin: 0 auto;

            display: flex;

            align-items: center;

            justify-content: space-between;
        }

        .brand {
            display: flex;

            align-items: center;

            gap: 11px;

            font-size: 18px;

            font-weight: 800;
        }

        .brand-logo {
            width: 40px;
            height: 40px;

            border-radius: 10px;

            object-fit: cover;

            background: #11111a;

            border:
                1px solid
                rgba(139, 92, 246, 0.35);

            box-shadow:
                0 0 20px
                rgba(124, 58, 237, 0.18);
        }

        .brand-text span {
            display: block;
        }

        .brand-subtitle {
            margin-top: 2px;

            color: #777083;

            font-size: 7px;

            letter-spacing: 1.5px;
        }

        .nav-links {
            display: flex;

            align-items: center;

            gap: 28px;

            color: #918b9f;

            font-size: 12px;

            font-weight: 600;
        }

        .nav-links a {
            transition: 0.2s ease;
        }

        .nav-links a:hover {
            color: #ffffff;
        }

        .nav-login {
            padding: 9px 15px;

            border:
                1px solid
                rgba(139, 92, 246, 0.45);

            border-radius: 7px;

            color: #ffffff;

            background:
                rgba(124, 58, 237, 0.10);
        }

        .nav-login:hover {
            background:
                rgba(124, 58, 237, 0.20);
        }

        /* =========================================================
           HERO
        ========================================================= */

        .hero {
            position: relative;

            min-height: 820px;

            display: flex;

            align-items: center;

            justify-content: center;

            padding:
                150px 24px
                100px;

            text-align: center;

            overflow: hidden;
        }

        .hero-glow {
            position: absolute;

            width: 700px;
            height: 500px;

            top: 80px;
            right: -120px;

            background:
                radial-gradient(
                    circle,
                    rgba(124, 58, 237, 0.25),
                    transparent 68%
                );

            filter: blur(30px);

            pointer-events: none;
        }

        .hero-glow-left {
            position: absolute;

            width: 450px;
            height: 450px;

            bottom: -200px;
            left: -150px;

            background:
                radial-gradient(
                    circle,
                    rgba(91, 33, 182, 0.14),
                    transparent 70%
                );

            filter: blur(30px);

            pointer-events: none;
        }

        .hero-content {
            position: relative;

            z-index: 2;

            max-width: 900px;

            margin: 0 auto;
        }

        .hero-badge {
            display: inline-flex;

            align-items: center;

            gap: 8px;

            padding: 7px 12px;

            margin-bottom: 24px;

            border:
                1px solid
                rgba(139, 92, 246, 0.25);

            border-radius: 999px;

            color: #b7a5d8;

            background:
                rgba(124, 58, 237, 0.07);

            font-size: 9px;

            font-weight: 700;

            letter-spacing: 1px;

            text-transform: uppercase;
        }

        .hero-badge-dot {
            width: 6px;
            height: 6px;

            border-radius: 50%;

            background: #a855f7;

            box-shadow:
                0 0 10px
                rgba(168, 85, 247, 0.9);
        }

        .hero h1 {
            margin: 0;

            font-size:
                clamp(
                    48px,
                    8vw,
                    92px
                );

            line-height: 0.98;

            letter-spacing: -4px;

            font-weight: 900;
        }

        .hero h1 .gradient {
            background:
                linear-gradient(
                    135deg,
                    #ffffff 20%,
                    #c084fc 60%,
                    #7c3aed 100%
                );

            -webkit-background-clip: text;

            background-clip: text;

            color: transparent;
        }

        .hero-description {
            max-width: 650px;

            margin: 28px auto 0;

            color: #918b9f;

            font-size: 16px;

            line-height: 1.8;
        }

        .hero-slogan {
            margin-top: 13px;

            color: #b9a8d4;

            font-size: 11px;

            font-style: italic;
        }

        .hero-actions {
            display: flex;

            justify-content: center;

            gap: 12px;

            margin-top: 35px;
        }

        .button {
            display: inline-flex;

            align-items: center;

            justify-content: center;

            padding: 13px 21px;

            border-radius: 8px;

            font-size: 11px;

            font-weight: 800;

            transition:
                transform 0.2s ease,
                box-shadow 0.2s ease,
                background 0.2s ease;
        }

        .button:hover {
            transform: translateY(-2px);
        }

        .button-primary {
            background:
                linear-gradient(
                    135deg,
                    #7c3aed,
                    #6d28d9
                );

            border:
                1px solid
                #8b5cf6;

            box-shadow:
                0 0 30px
                rgba(124, 58, 237, 0.25);
        }

        .button-primary:hover {
            box-shadow:
                0 0 38px
                rgba(124, 58, 237, 0.45);
        }

        .button-secondary {
            background:
                rgba(255,255,255,0.025);

            border:
                1px solid
                #29233a;

            color: #d5d0df;
        }

        .button-secondary:hover {
            background:
                rgba(124, 58, 237, 0.08);

            border-color:
                rgba(139, 92, 246, 0.35);
        }

        /* =========================================================
           HERO DASHBOARD PREVIEW
        ========================================================= */

        .preview-wrapper {
            max-width: 1100px;

            margin: 75px auto 0;

            position: relative;
        }

        .preview-glow {
            position: absolute;

            inset: 15%;

            background:
                rgba(124, 58, 237, 0.18);

            filter: blur(70px);

            z-index: -1;
        }

        .dashboard-preview {
            position: relative;

            display: grid;

            grid-template-columns:
                155px 1fr;

            min-height: 420px;

            text-align: left;

            background:
                #0b0b13;

            border:
                1px solid
                #27213a;

            border-radius: 14px;

            overflow: hidden;

            box-shadow:
                0 35px 90px
                rgba(0,0,0,0.55),
                0 0 50px
                rgba(124,58,237,0.10);
        }

        .preview-sidebar {
            padding: 18px 10px;

            background:
                #090910;

            border-right:
                1px solid
                #211b30;
        }

        .preview-brand {
            padding: 5px 8px 20px;

            font-size: 10px;

            font-weight: 800;
        }

        .preview-nav {
            display: flex;

            flex-direction: column;

            gap: 5px;
        }

        .preview-nav-item {
            padding: 8px;

            color: #696376;

            border-radius: 5px;

            font-size: 8px;
        }

        .preview-nav-item.active {
            color: #ffffff;

            background:
                rgba(124,58,237,0.18);

            box-shadow:
                inset 2px 0 #8b5cf6;
        }

        .preview-content {
            padding: 25px;
        }

        .preview-top {
            display: flex;

            justify-content: space-between;

            align-items: center;

            margin-bottom: 20px;
        }

        .preview-title {
            font-size: 16px;

            font-weight: 800;
        }

        .preview-status {
            padding: 6px 9px;

            border-radius: 5px;

            color: #4ade80;

            background:
                rgba(34,197,94,0.07);

            font-size: 7px;
        }

        .preview-stats {
            display: grid;

            grid-template-columns:
                repeat(4, 1fr);

            gap: 8px;
        }

        .preview-stat {
            padding: 13px;

            background:
                #10101a;

            border:
                1px solid
                #211b30;

            border-radius: 7px;
        }

        .preview-stat-label {
            color: #686274;

            font-size: 7px;
        }

        .preview-stat-value {
            margin-top: 6px;

            font-size: 15px;

            font-weight: 800;
        }

        .preview-panels {
            display: grid;

            grid-template-columns:
                1.7fr 1fr;

            gap: 8px;

            margin-top: 8px;
        }

        .preview-panel {
            min-height: 190px;

            padding: 14px;

            background:
                #10101a;

            border:
                1px solid
                #211b30;

            border-radius: 7px;
        }

        .preview-panel-title {
            color: #c9c3d4;

            font-size: 8px;

            font-weight: 700;
        }

        .fake-chart {
            position: relative;

            height: 130px;

            margin-top: 15px;

            overflow: hidden;

            background:
                linear-gradient(
                    rgba(255,255,255,0.025) 1px,
                    transparent 1px
                );

            background-size:
                100% 32px;
        }

        .fake-chart svg {
            width: 100%;
            height: 100%;
        }

        .fake-line {
            fill: none;

            stroke: #8b5cf6;

            stroke-width: 2;

            filter:
                drop-shadow(
                    0 0 5px
                    rgba(139,92,246,0.6)
                );
        }

        .preview-list {
            margin-top: 15px;
        }

        .preview-list-item {
            display: flex;

            justify-content: space-between;

            padding: 9px 0;

            border-bottom:
                1px solid
                #1d1927;

            color: #797283;

            font-size: 7px;
        }

        .preview-list-item strong {
            color: #c8c1d4;
        }

        /* =========================================================
           FEATURES
        ========================================================= */

        .section {
            max-width: 1200px;

            margin: 0 auto;

            padding:
                100px 24px;
        }

        .section-heading {
            max-width: 650px;

            margin: 0 auto 50px;

            text-align: center;
        }

        .section-kicker {
            color: #a855f7;

            font-size: 9px;

            font-weight: 800;

            letter-spacing: 2px;

            text-transform: uppercase;
        }

        .section-heading h2 {
            margin: 12px 0 0;

            font-size:
                clamp(
                    32px,
                    5vw,
                    48px
                );

            letter-spacing: -2px;
        }

        .section-heading p {
            margin-top: 15px;

            color: #7e778b;

            font-size: 13px;

            line-height: 1.7;
        }

        .features-grid {
            display: grid;

            grid-template-columns:
                repeat(3, 1fr);

            gap: 12px;
        }

        .feature-card {
            position: relative;

            padding: 25px;

            min-height: 220px;

            background:
                linear-gradient(
                    145deg,
                    rgba(18,17,27,0.95),
                    rgba(9,9,15,0.95)
                );

            border:
                1px solid
                #211a34;

            border-radius: 12px;

            overflow: hidden;

            transition:
                transform 0.25s ease,
                border-color 0.25s ease,
                box-shadow 0.25s ease;
        }

        .feature-card::after {
            content: "";

            position: absolute;

            width: 150px;
            height: 150px;

            top: -80px;
            right: -70px;

            background:
                radial-gradient(
                    circle,
                    rgba(124,58,237,0.16),
                    transparent 70%
                );
        }

        .feature-card:hover {
            transform: translateY(-5px);

            border-color:
                rgba(139,92,246,0.35);

            box-shadow:
                0 18px 45px
                rgba(76,29,149,0.12);
        }

        .feature-icon {
            width: 42px;
            height: 42px;

            display: grid;

            place-items: center;

            border-radius: 10px;

            color: #c084fc;

            background:
                rgba(124,58,237,0.10);

            border:
                1px solid
                rgba(139,92,246,0.18);

            font-size: 18px;
        }

        .feature-card h3 {
            margin:
                22px 0 8px;

            font-size: 15px;
        }

        .feature-card p {
            margin: 0;

            color: #777082;

            font-size: 11px;

            line-height: 1.7;
        }

        /* =========================================================
           COMMUNITY
        ========================================================= */

        .community {
            position: relative;

            max-width: 1150px;

            margin:
                20px auto 100px;

            padding:
                70px 40px;

            text-align: center;

            border:
                1px solid
                #291f3d;

            border-radius: 16px;

            background:
                radial-gradient(
                    circle at 50% 0%,
                    rgba(124,58,237,0.13),
                    transparent 65%
                ),
                #0b0a12;

            overflow: hidden;
        }

        .community h2 {
            margin: 0;

            font-size:
                clamp(
                    30px,
                    5vw,
                    46px
                );

            letter-spacing: -2px;
        }

        .community p {
            max-width: 620px;

            margin:
                16px auto 0;

            color: #827b8d;

            font-size: 13px;

            line-height: 1.8;
        }

        .community-slogan {
            margin-top: 18px;

            color: #c084fc;

            font-size: 11px;

            font-weight: 700;
        }

        .community-actions {
            display: flex;

            justify-content: center;

            gap: 10px;

            margin-top: 28px;
        }

        /* =========================================================
           FOOTER
        ========================================================= */

        footer {
            border-top:
                1px solid
                #171420;

            background:
                #050509;
        }

        .footer-inner {
            max-width: 1200px;

            margin: 0 auto;

            padding:
                45px 24px 25px;
        }

        .footer-top {
            display: grid;

            grid-template-columns:
                1.5fr 1fr 1fr 1fr;

            gap: 35px;
        }

        .footer-brand p {
            max-width: 300px;

            color: #686171;

            font-size: 10px;

            line-height: 1.7;
        }

        .footer-column h4 {
            margin:
                0 0 13px;

            color: #aaa3b3;

            font-size: 9px;

            text-transform: uppercase;

            letter-spacing: 1px;
        }

        .footer-column a {
            display: block;

            margin-bottom: 9px;

            color: #66606e;

            font-size: 9px;

            transition: 0.2s ease;
        }

        .footer-column a:hover {
            color: #ffffff;
        }

        .footer-bottom {
            display: flex;

            justify-content: space-between;

            align-items: center;

            gap: 20px;

            margin-top: 40px;

            padding-top: 20px;

            border-top:
                1px solid
                #15121d;

            color: #514c59;

            font-size: 8px;
        }

        /* =========================================================
           RESPONSIVE
        ========================================================= */

        @media (max-width: 900px) {

            .nav-links a:not(.nav-login) {
                display: none;
            }

            .dashboard-preview {
                grid-template-columns: 110px 1fr;
            }

            .features-grid {
                grid-template-columns:
                    repeat(2, 1fr);
            }

            .footer-top {
                grid-template-columns:
                    repeat(2, 1fr);
            }

        }

        @media (max-width: 650px) {

            .navbar {
                padding:
                    15px 18px;
            }

            .hero {
                min-height: 720px;

                padding:
                    130px 18px 70px;
            }

            .hero h1 {
                letter-spacing: -2px;
            }

            .hero-description {
                font-size: 13px;
            }

            .hero-actions {
                flex-direction: column;

                max-width: 280px;

                margin-left: auto;
                margin-right: auto;
            }

            .preview-wrapper {
                display: none;
            }

            .features-grid {
                grid-template-columns: 1fr;
            }

            .section {
                padding:
                    75px 18px;
            }

            .community {
                margin:
                    10px 18px 70px;

                padding:
                    50px 22px;
            }

            .community-actions {
                flex-direction: column;
            }

            .footer-top {
                grid-template-columns: 1fr;
            }

            .footer-bottom {
                flex-direction: column;

                align-items: flex-start;
            }

        }

    </style>

</head>

<body>

    <!-- =========================================================
         NAVIGATION
    ========================================================= -->

    <nav class="navbar">

        <div class="navbar-inner">

            <a
                href="/dashboard"
                class="brand"
            >

                <img
                    class="brand-logo"
                    src="/dashboard/assets/btw-mechanic-logo.png"
                    alt="BTW Mechanic"
                >

                <div class="brand-text">

                    <span>
                        BTW Mechanic
                    </span>

                    <span class="brand-subtitle">
                        BEYOND TWO WHEELS
                    </span>

                </div>

            </a>

            <div class="nav-links">

                <a href="#features">
                    Features
                </a>

                <a href="#dashboard">
                    Dashboard
                </a>

                <a href="#community">
                    Community
                </a>

                <a
                    href="/dashboard/auth/discord"
                    class="nav-login"
                >
                    Dashboard
                </a>

            </div>

        </div>

    </nav>


    <!-- =========================================================
         HERO
    ========================================================= -->

    <section class="hero">

        <div class="hero-glow"></div>

        <div class="hero-glow-left"></div>

        <div class="hero-content">

            <div class="hero-badge">

                <span class="hero-badge-dot"></span>

                Built by the BTW community - For the community

            </div>

            <h1>

                Your community.

                <br>

                <span class="gradient">
                    Powered by 

                    <br>

                    <span class="gradient">
                    The BTW Mechanic
                </span>

            </h1>

            <p class="hero-description">

                A powerful Discord bot built specifically
                for the Beyond Two Wheels community —
                bringing moderation, support, ranks,
                events and server utilities together
                in one place.

            </p>

            <div class="hero-slogan">

                Serving the Beyond Two Wheels Community,
                one crank at a time.

            </div>

            <div class="hero-actions">

                <a
                    href="https://discord.com/oauth2/authorize?client_id=1535038083957919765&permissions=8&integration_type=0&scope=bot"
                    class="button button-primary"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    ⚙ Add to Discord
                </a>

                <a
                    href="https://discord.gg/wUGdq9fqDX"
                    class="button button-secondary"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    🏍 Join Beyond Two Wheels
                </a>

            </div>


            <!-- DASHBOARD PREVIEW -->

            <div
                class="preview-wrapper"
                id="dashboard"
            >

                <div class="preview-glow"></div>

                <div class="dashboard-preview">

                    <div class="preview-sidebar">

                        <div class="preview-brand">
                            ⚙ BTW Mechanic
                        </div>

                        <div class="preview-nav">

                            <div class="preview-nav-item active">
                                ⌂ Dashboard
                            </div>

                            <div class="preview-nav-item">
                                ♙ Servers
                            </div>

                            <div class="preview-nav-item">
                                ♙ Users
                            </div>

                            <div class="preview-nav-item">
                                ⌘ Commands
                            </div>

                            <div class="preview-nav-item">
                                ◈ Moderation
                            </div>

                            <div class="preview-nav-item">
                                ▱ Tickets
                            </div>

                            <div class="preview-nav-item">
                                ♢ Giveaways
                            </div>

                            <div class="preview-nav-item">
                                ♫ Music
                            </div>

                            <div class="preview-nav-item">
                                ⚙ Settings
                            </div>

                        </div>

                    </div>

                    <div class="preview-content">

                        <div class="preview-top">

                            <div class="preview-title">
                                Dashboard
                            </div>

                            <div class="preview-status">
                                ● BOT ONLINE
                            </div>

                        </div>

                        <div class="preview-stats">

                            <div class="preview-stat">

                                <div class="preview-stat-label">
                                    Servers
                                </div>

                                <div class="preview-stat-value">
                                    1
                                </div>

                            </div>

                            <div class="preview-stat">

                                <div class="preview-stat-label">
                                    Users
                                </div>

                                <div class="preview-stat-value">
                                    1,284
                                </div>

                            </div>

                            <div class="preview-stat">

                                <div class="preview-stat-label">
                                    Messages
                                </div>

                                <div class="preview-stat-value">
                                    24.8K
                                </div>

                            </div>

                            <div class="preview-stat">

                                <div class="preview-stat-label">
                                    Commands
                                </div>

                                <div class="preview-stat-value">
                                    8.4K
                                </div>

                            </div>

                        </div>

                        <div class="preview-panels">

                            <div class="preview-panel">

                                <div class="preview-panel-title">
                                    Command Usage
                                </div>

                                <div class="fake-chart">

                                    <svg
                                        viewBox="0 0 600 130"
                                        preserveAspectRatio="none"
                                    >

                                        <path
                                            class="fake-line"
                                            d="
                                                M0 110
                                                L50 100
                                                L100 106
                                                L150 72
                                                L200 86
                                                L250 60
                                                L300 70
                                                L350 35
                                                L400 55
                                                L450 45
                                                L500 20
                                                L550 35
                                                L600 10
                                            "
                                        />

                                    </svg>

                                </div>

                            </div>

                            <div class="preview-panel">

                                <div class="preview-panel-title">
                                    Top Commands
                                </div>

                                <div class="preview-list">

                                    <div class="preview-list-item">
                                        <strong>/help</strong>
                                        1,248
                                    </div>

                                    <div class="preview-list-item">
                                        <strong>/warn</strong>
                                        634
                                    </div>

                                    <div class="preview-list-item">
                                        <strong>/ticket</strong>
                                        421
                                    </div>

                                    <div class="preview-list-item">
                                        <strong>/rank</strong>
                                        318
                                    </div>

                                </div>

                            </div>

                        </div>

                    </div>

                </div>

            </div>

        </div>

    </section>


    <!-- =========================================================
         FEATURES
    ========================================================= -->

    <section
        class="section"
        id="features"
    >

        <div class="section-heading">

            <div class="section-kicker">
                Everything you need
            </div>

            <h2>
                Built around your community.
            </h2>

            <p>
                BTW Mechanic brings the tools that keep
                Beyond Two Wheels running together in one
                powerful Discord bot.
            </p>

        </div>

        <div class="features-grid">


            <div class="feature-card">

                <div class="feature-icon">
                    🛠️
                </div>

                <h3>
                    Moderation
                </h3>

                <p>
                    Keep your community clean, safe and
                    well-managed with powerful moderation
                    tools built directly into Discord.
                </p>

            </div>


            <div class="feature-card">

                <div class="feature-icon">
                    🎫
                </div>

                <h3>
                    Modmail & Support
                </h3>

                <p>
                    Give members a private and simple way
                    to contact your moderation team whenever
                    they need help.
                </p>

            </div>


            <div class="feature-card">

                <div class="feature-icon">
                    📊
                </div>

                <h3>
                    Ranks & XP
                </h3>

                <p>
                    Reward active members with XP, ranks
                    and progression that encourage people
                    to stay involved.
                </p>

            </div>


            <div class="feature-card">

                <div class="feature-icon">
                    🎉
                </div>

                <h3>
                    Events & Community
                </h3>

                <p>
                    Make community events, announcements
                    and engagement easier to organise and
                    manage.
                </p>

            </div>


            <div class="feature-card">

                <div class="feature-icon">
                    🤖
                </div>

                <h3>
                    Server Utilities
                </h3>

                <p>
                    Automation, logging, member management
                    and useful utilities designed to keep
                    your server running smoothly.
                </p>

            </div>


            <div class="feature-card">

                <div class="feature-icon">
                    📈
                </div>

                <h3>
                    Web Dashboard
                </h3>

                <p>
                    See your bot's activity, command usage,
                    server statistics and system status from
                    one central dashboard.
                </p>

            </div>

        </div>

    </section>


    <!-- =========================================================
         COMMUNITY CTA
    ========================================================= -->

    <section
        class="community"
        id="community"
    >

        <div class="section-kicker">
            Beyond Two Wheels Collective
        </div>

        <h2>
            Driven by passion.
            <br>
            Connected by wheels.
        </h2>

        <p>
            BTW Mechanic is built to serve the community
            behind Beyond Two Wheels — giving members and
            staff the tools they need to keep the server
            active, organised and connected.
        </p>

        <div class="community-slogan">
            Serving the Beyond Two Wheels Community,
            one crank at a time.
        </div>

        <div class="community-actions">

            <a
                href="https://discord.gg/wUGdq9fqDX"
                class="button button-primary"
                target="_blank"
                rel="noopener noreferrer"
            >
                🏍 Join the Community
            </a>

            <a
                href="https://discord.gg/wtrjtFBmag"
                class="button button-secondary"
                target="_blank"
                rel="noopener noreferrer"
            >
                🎫 Visit Support
            </a>

        </div>

    </section>


    <!-- =========================================================
         FOOTER
    ========================================================= -->

    <footer>

        <div class="footer-inner">

            <div class="footer-top">

                <div class="footer-brand">

                    <a
                        href="/dashboard"
                        class="brand"
                    >

                        <img
                            class="brand-logo"
                            src="/dashboard/assets/btw-mechanic-logo.png"
                            alt="BTW Mechanic"
                        >

                        <div class="brand-text">

                            <span>
                                BTW Mechanic
                            </span>

                            <span class="brand-subtitle">
                                BEYOND TWO WHEELS
                            </span>

                        </div>

                    </a>

                    <p>
                        Serving the Beyond Two Wheels Community,
                        one crank at a time.
                    </p>

                </div>


                <div class="footer-column">

                    <h4>
                        Navigate
                    </h4>

                    <a href="#features">
                        Features
                    </a>

                    <a href="#dashboard">
                        Dashboard
                    </a>

                    <a
                        href="/dashboard/auth/discord"
                    >
                        Login
                    </a>

                </div>


                <div class="footer-column">

                    <h4>
                        Community
                    </h4>

                    <a
                        href="https://discord.gg/wUGdq9fqDX"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        Beyond Two Wheels
                    </a>

                    <a
                        href="https://discord.gg/wtrjtFBmag"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        Support Server
                    </a>

                    <a
                        href="https://discord.com/oauth2/authorize?client_id=1535038083957919765&permissions=8&integration_type=0&scope=bot"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        Add to Discord
                    </a>

                </div>


                <div class="footer-column">

                    <h4>
                        Legal
                    </h4>

                    <a href="/privacy">
                        Privacy Policy
                    </a>

                    <a href="/terms">
                        Terms of Use
                    </a>

                </div>

            </div>


            <div class="footer-bottom">

                <span>
                    © 2026 Beyond Two Wheels Collective.
                    All rights reserved.
                </span>

                <span>
                    BTW Mechanic
                </span>

            </div>

        </div>

    </footer>

</body>

</html>
`);
});

/*
|--------------------------------------------------------------------------
| DISCORD OAUTH
|--------------------------------------------------------------------------
*/

router.get(
    '/auth/discord',
    (req, res) => {
        res.redirect(
            getDiscordOAuthUrl()
        );
    }
);

router.get(
    '/auth/discord/callback',
    async (req, res) => {

        try {

            const { code } =
                req.query;

            if (!code) {
                return res
                    .status(400)
                    .send(
                        'Missing Discord authorization code.'
                    );
            }

            const tokenResponse =
                await fetch(
                    'https://discord.com/api/oauth2/token',
                    {
                        method: 'POST',

                        headers: {
                            'Content-Type':
                                'application/x-www-form-urlencoded',
                        },

                        body:
                            new URLSearchParams({

                                client_id:
                                    process.env
                                        .DISCORD_CLIENT_ID,

                                client_secret:
                                    process.env
                                        .DISCORD_CLIENT_SECRET,

                                grant_type:
                                    'authorization_code',

                                code:
                                    String(code),

                                redirect_uri:
                                    process.env
                                        .DISCORD_REDIRECT_URI,

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

            const userResponse =
                await fetch(
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

            req.session.user =
                user;

            return res.redirect(
                '/dashboard'
            );

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

router.get(
    '/logout',
    (req, res) => {

        req.session.destroy(
            () => {
                res.redirect(
                    '/dashboard'
                );
            }
        );

    }
);

export default router;