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
        content="BTW Mechanic — powerful Discord tools built for the Beyond Two Wheels community."
    >

    <meta
        name="theme-color"
        content="#06060b"
    >

    <title>
        BTW Mechanic | Beyond Two Wheels
    </title>

    <style>

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        html {
            scroll-behavior: smooth;
        }

        body {
            min-height: 100vh;

            overflow-x: hidden;

            font-family:
                Inter,
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
        }

        body::before {
            content: "";

            position: fixed;

            inset: 0;

            pointer-events: none;

            background:
                radial-gradient(
                    circle at 15% 40%,
                    rgba(124, 58, 237, 0.07),
                    transparent 32%
                );

            z-index: -1;
        }

        a {
            color: inherit;

            text-decoration: none;
        }

        button {
            font: inherit;
        }

        /* -------------------------------------------------
           NAVBAR
        ------------------------------------------------- */

        .site-nav {
            position: fixed;

            top: 0;
            left: 0;
            right: 0;

            height: 76px;

            display: flex;

            align-items: center;

            justify-content: space-between;

            padding: 0 5%;

            background:
                rgba(
                    6,
                    6,
                    11,
                    0.72
                );

            border-bottom:
                1px solid
                rgba(
                    139,
                    92,
                    246,
                    0.10
                );

            backdrop-filter: blur(18px);

            -webkit-backdrop-filter: blur(18px);

            z-index: 1000;
        }

        .nav-brand {
            display: flex;

            align-items: center;

            gap: 11px;

            font-weight: 800;

            white-space: nowrap;
        }

        .nav-logo {
            width: 39px;
            height: 39px;

            object-fit: contain;

            border-radius: 10px;
        }

        .nav-brand-text {
            display: flex;

            flex-direction: column;

            gap: 2px;
        }

        .nav-brand-name {
            font-size: 15px;

            letter-spacing: -0.3px;
        }

        .nav-brand-subtitle {
            color: #81758f;

            font-size: 7px;

            font-weight: 800;

            letter-spacing: 1.4px;
        }

        .nav-links {
            display: flex;

            align-items: center;

            gap: 29px;

            margin-left: auto;

            margin-right: 28px;
        }

        .nav-links a {
            color: #aaa3b7;

            font-size: 11px;

            font-weight: 600;

            transition:
                color .2s ease;
        }

        .nav-links a:hover {
            color: #ffffff;
        }

        .nav-button {
            display: inline-flex;

            align-items: center;

            justify-content: center;

            padding: 10px 17px;

            color: #ffffff;

            background:
                linear-gradient(
                    135deg,
                    #7c3aed,
                    #6d28d9
                );

            border:
                1px solid
                #8b5cf6;

            border-radius: 8px;

            font-size: 10px;

            font-weight: 800;

            box-shadow:
                0 0 20px
                rgba(
                    124,
                    58,
                    237,
                    0.25
                );

            transition:
                transform .2s ease,
                box-shadow .2s ease;
        }

        .nav-button:hover {
            transform:
                translateY(-2px);

            box-shadow:
                0 0 30px
                rgba(
                    124,
                    58,
                    237,
                    0.45
                );
        }

        /* -------------------------------------------------
           HERO
        ------------------------------------------------- */

        .hero {
            position: relative;

            min-height: 850px;

            display: flex;

            align-items: center;

            justify-content: center;

            padding:
                145px 6%
                100px;

            text-align: center;

            overflow: hidden;
        }

        .hero::before {
            content: "";

            position: absolute;

            width: 800px;
            height: 500px;

            top: 80px;
            left: 50%;

            transform:
                translateX(-50%);

            background:
                radial-gradient(
                    ellipse,
                    rgba(
                        124,
                        58,
                        237,
                        0.20
                    ),
                    transparent 68%
                );

            filter: blur(20px);

            pointer-events: none;
        }

        .hero-content {
            position: relative;

            max-width: 950px;

            z-index: 2;
        }

        .hero-badge {
            display: inline-flex;

            align-items: center;

            gap: 8px;

            padding:
                7px 12px;

            margin-bottom: 25px;

            color: #c4b5fd;

            background:
                rgba(
                    124,
                    58,
                    237,
                    0.08
                );

            border:
                1px solid
                rgba(
                    139,
                    92,
                    246,
                    0.25
                );

            border-radius: 999px;

            font-size: 9px;

            font-weight: 800;

            letter-spacing: .6px;
        }

        .hero-badge-dot {
            width: 6px;
            height: 6px;

            border-radius: 50%;

            background: #a855f7;

            box-shadow:
                0 0 10px
                rgba(
                    168,
                    85,
                    247,
                    .9
                );
        }

        .hero h1 {
            max-width: 900px;

            margin:
                0 auto
                22px;

            font-size:
                clamp(
                    48px,
                    7vw,
                    88px
                );

            line-height: .98;

            letter-spacing:
                -4px;

            font-weight: 900;
        }

        .hero h1 .purple {
            color: #a855f7;

            text-shadow:
                0 0 35px
                rgba(
                    168,
                    85,
                    247,
                    .25
                );
        }

        .hero-description {
            max-width: 650px;

            margin:
                0 auto;

            color: #aaa5b6;

            font-size: 16px;

            line-height: 1.75;
        }

        .hero-actions {
            display: flex;

            justify-content: center;

            gap: 12px;

            margin-top: 34px;
        }

        .primary-button,
        .secondary-button {
            display: inline-flex;

            align-items: center;

            justify-content: center;

            min-width: 155px;

            padding:
                13px 20px;

            border-radius: 9px;

            font-size: 11px;

            font-weight: 800;

            transition:
                transform .2s ease,
                box-shadow .2s ease,
                background .2s ease;
        }

        .primary-button {
            background:
                linear-gradient(
                    135deg,
                    #8b5cf6,
                    #6d28d9
                );

            border:
                1px solid
                #a78bfa;

            box-shadow:
                0 0 28px
                rgba(
                    124,
                    58,
                    237,
                    .28
                );
        }

        .primary-button:hover {
            transform:
                translateY(-2px);

            box-shadow:
                0 0 40px
                rgba(
                    124,
                    58,
                    237,
                    .48
                );
        }

        .secondary-button {
            background:
                rgba(
                    255,
                    255,
                    255,
                    .025
                );

            border:
                1px solid
                #30263f;

            color: #d0cbd8;
        }

        .secondary-button:hover {
            transform:
                translateY(-2px);

            background:
                rgba(
                    124,
                    58,
                    237,
                    .08
                );

            border-color:
                #6d28d9;
        }

        /* -------------------------------------------------
           PRODUCT VISUAL
        ------------------------------------------------- */

        .hero-visual {
            position: relative;

            width: min(
                900px,
                92vw
            );

            margin:
                75px auto
                0;

            padding: 9px;

            background:
                linear-gradient(
                    135deg,
                    rgba(
                        139,
                        92,
                        246,
                        .30
                    ),
                    rgba(
                        37,
                        16,
                        79,
                        .15
                    )
                );

            border:
                1px solid
                rgba(
                    139,
                    92,
                    246,
                    .28
                );

            border-radius: 18px;

            box-shadow:
                0 30px 100px
                rgba(
                    0,
                    0,
                    0,
                    .45
                ),
                0 0 80px
                rgba(
                    124,
                    58,
                    237,
                    .10
                );
        }

        .visual-window {
            min-height: 300px;

            display: grid;

            grid-template-columns:
                190px
                1fr;

            text-align: left;

            overflow: hidden;

            background:
                #0c0b12;

            border-radius: 11px;
        }

        .visual-sidebar {
            padding: 20px 14px;

            background:
                #090910;

            border-right:
                1px solid
                #1d1927;
        }

        .visual-server {
            display: flex;

            align-items: center;

            gap: 9px;

            margin-bottom: 24px;

            font-size: 11px;

            font-weight: 800;
        }

        .visual-server img {
            width: 28px;
            height: 28px;

            border-radius: 8px;
        }

        .visual-menu {
            display: flex;

            flex-direction: column;

            gap: 5px;
        }

        .visual-menu span {
            padding:
                8px 9px;

            color: #686173;

            border-radius: 6px;

            font-size: 9px;
        }

        .visual-menu span.active {
            color: #ffffff;

            background:
                rgba(
                    124,
                    58,
                    237,
                    .18
                );
        }

        .visual-content {
            padding: 25px;
        }

        .visual-header {
            display: flex;

            align-items: center;

            justify-content: space-between;

            margin-bottom: 22px;
        }

        .visual-title {
            font-size: 18px;

            font-weight: 800;
        }

        .visual-status {
            padding:
                6px 10px;

            color: #4ade80;

            background:
                rgba(
                    34,
                    197,
                    94,
                    .08
                );

            border:
                1px solid
                rgba(
                    34,
                    197,
                    94,
                    .18
                );

            border-radius: 6px;

            font-size: 8px;

            font-weight: 800;
        }

        .visual-cards {
            display: grid;

            grid-template-columns:
                repeat(
                    3,
                    1fr
                );

            gap: 10px;
        }

        .visual-card {
            min-height: 95px;

            padding: 14px;

            background:
                #11101a;

            border:
                1px solid
                #242033;

            border-radius: 9px;
        }

        .visual-card-icon {
            margin-bottom: 13px;

            font-size: 17px;
        }

        .visual-card strong {
            display: block;

            margin-bottom: 4px;

            font-size: 10px;
        }

        .visual-card span {
            color: #716b7d;

            font-size: 8px;

            line-height: 1.5;
        }

        /* -------------------------------------------------
           SECTION
        ------------------------------------------------- */

        .section {
            width: min(
                1120px,
                90%
            );

            margin:
                0 auto;

            padding:
                105px 0;
        }

        .section-heading {
            max-width: 650px;

            margin-bottom: 45px;
        }

        .eyebrow {
            margin-bottom: 12px;

            color: #a855f7;

            font-size: 9px;

            font-weight: 900;

            letter-spacing: 1.5px;

            text-transform:
                uppercase;
        }

        .section-heading h2 {
            margin-bottom: 13px;

            font-size:
                clamp(
                    30px,
                    4vw,
                    48px
                );

            letter-spacing:
                -1.8px;
        }

        .section-heading p {
            color: #9c96a8;

            font-size: 14px;

            line-height: 1.7;
        }

        /* -------------------------------------------------
           FEATURES
        ------------------------------------------------- */

        .feature-grid {
            display: grid;

            grid-template-columns:
                repeat(
                    3,
                    1fr
                );

            gap: 13px;
        }

        .feature-card {
            position: relative;

            min-height: 210px;

            padding: 25px;

            background:
                linear-gradient(
                    145deg,
                    rgba(
                        18,
                        16,
                        28,
                        .98
                    ),
                    rgba(
                        11,
                        11,
                        18,
                        .98
                    )
                );

            border:
                1px solid
                #211a30;

            border-radius: 13px;

            overflow: hidden;

            transition:
                transform .25s ease,
                border-color .25s ease,
                box-shadow .25s ease;
        }

        .feature-card::before {
            content: "";

            position: absolute;

            width: 120px;
            height: 120px;

            top: -65px;
            right: -50px;

            background:
                rgba(
                    124,
                    58,
                    237,
                    .14
                );

            border-radius: 50%;

            filter: blur(15px);
        }

        .feature-card:hover {
            transform:
                translateY(-5px);

            border-color:
                rgba(
                    139,
                    92,
                    246,
                    .42
                );

            box-shadow:
                0 20px 45px
                rgba(
                    0,
                    0,
                    0,
                    .25
                );
        }

        .feature-icon {
            width: 43px;
            height: 43px;

            display: grid;

            place-items: center;

            margin-bottom: 20px;

            background:
                rgba(
                    124,
                    58,
                    237,
                    .12
                );

            border:
                1px solid
                rgba(
                    139,
                    92,
                    246,
                    .20
                );

            border-radius: 10px;

            font-size: 19px;
        }

        .feature-card h3 {
            margin-bottom: 9px;

            font-size: 14px;
        }

        .feature-card p {
            color: #8d8798;

            font-size: 11px;

            line-height: 1.65;
        }

        /* -------------------------------------------------
           HOW IT WORKS
        ------------------------------------------------- */

        .how-section {
            width: min(
                1120px,
                90%
            );

            margin:
                0 auto;

            padding:
                90px 0
                110px;
        }

        .how-visual {
            position: relative;

            display: grid;

            grid-template-columns:
                repeat(
                    3,
                    1fr
                );

            gap: 18px;

            padding: 55px 30px;

            background:
                linear-gradient(
                    145deg,
                    #0d0c14,
                    #0a0910
                );

            border:
                1px solid
                #211a30;

            border-radius: 18px;

            overflow: hidden;
        }

        .how-visual::before {
            content: "";

            position: absolute;

            width: 500px;
            height: 300px;

            left: 50%;
            top: 50%;

            transform:
                translate(
                    -50%,
                    -50%
                );

            background:
                radial-gradient(
                    ellipse,
                    rgba(
                        124,
                        58,
                        237,
                        .12
                    ),
                    transparent 70%
                );

            pointer-events: none;
        }

        .how-step {
            position: relative;

            z-index: 1;

            text-align: center;
        }

        .how-number {
            width: 44px;
            height: 44px;

            display: grid;

            place-items: center;

            margin:
                0 auto
                18px;

            color: #c4b5fd;

            background:
                #171225;

            border:
                1px solid
                #5b21b6;

            border-radius: 50%;

            font-size: 12px;

            font-weight: 900;

            box-shadow:
                0 0 25px
                rgba(
                    124,
                    58,
                    237,
                    .15
                );
        }

        .how-step h3 {
            margin-bottom: 9px;

            font-size: 14px;
        }

        .how-step p {
            max-width: 220px;

            margin:
                0 auto;

            color: #858091;

            font-size: 10px;

            line-height: 1.65;
        }

        .how-line {
            position: absolute;

            top: 77px;
            left: 23%;

            width: 54%;

            height: 1px;

            background:
                linear-gradient(
                    90deg,
                    transparent,
                    #6d28d9,
                    transparent
                );

            opacity: .5;
        }

        /* -------------------------------------------------
           STATS
        ------------------------------------------------- */

        .stats-section {
            padding:
                80px 6%;

            border-top:
                1px solid
                rgba(
                    139,
                    92,
                    246,
                    .08
                );

            border-bottom:
                1px solid
                rgba(
                    139,
                    92,
                    246,
                    .08
                );

            background:
                rgba(
                    11,
                    10,
                    18,
                    .55
                );
        }

        .stats-inner {
            width: min(
                1050px,
                90%
            );

            display: grid;

            grid-template-columns:
                repeat(
                    3,
                    1fr
                );

            gap: 30px;

            margin:
                0 auto;

            text-align: center;
        }

        .stat-number {
            margin-bottom: 6px;

            font-size: 34px;

            font-weight: 900;

            color: #c4b5fd;
        }

        .stat-label {
            color: #777080;

            font-size: 10px;

            font-weight: 700;

            letter-spacing: .5px;
        }

        /* -------------------------------------------------
           REVIEWS
        ------------------------------------------------- */

        .reviews-section {
            overflow: hidden;

            padding:
                105px 0
                115px;
        }

        .reviews-heading {
            width: min(
                1120px,
                90%
            );

            margin:
                0 auto
                40px;
        }

        .review-track-wrapper {
            width: 100%;

            overflow: hidden;

            mask-image:
                linear-gradient(
                    90deg,
                    transparent,
                    black 8%,
                    black 92%,
                    transparent
                );

            -webkit-mask-image:
                linear-gradient(
                    90deg,
                    transparent,
                    black 8%,
                    black 92%,
                    transparent
                );
        }

        .review-track {
            display: flex;

            width: max-content;

            gap: 16px;

            animation:
                reviewScroll
                35s
                linear
                infinite;
        }

        .review-track:hover {
            animation-play-state:
                paused;
        }

        .review-card {
            width: 330px;

            min-height: 190px;

            padding: 21px;

            background:
                #0d0c14;

            border:
                1px solid
                #211a30;

            border-radius: 13px;

            flex-shrink: 0;
        }

        .review-top {
            display: flex;

            align-items: center;

            gap: 10px;

            margin-bottom: 16px;
        }

        .review-avatar {
            width: 37px;
            height: 37px;

            display: grid;

            place-items: center;

            border-radius: 50%;

            background:
                linear-gradient(
                    135deg,
                    #7c3aed,
                    #25104f
                );

            color: #ffffff;

            font-size: 11px;

            font-weight: 900;

            overflow: hidden;
        }

        .review-avatar img {
            width: 100%;
            height: 100%;

            object-fit: cover;
        }

        .review-user {
            flex: 1;
        }

        .review-username {
            margin-bottom: 3px;

            font-size: 10px;

            font-weight: 800;
        }

        .review-date {
            color: #625c6d;

            font-size: 8px;
        }

        .review-stars {
            color: #fbbf24;

            font-size: 11px;

            letter-spacing: 1px;
        }

        .review-note {
            color: #aaa4b4;

            font-size: 11px;

            line-height: 1.7;
        }

        @keyframes reviewScroll {

            from {
                transform:
                    translateX(0);
            }

            to {
                transform:
                    translateX(
                        -50%
                    );
            }

        }

        /* -------------------------------------------------
           COMMUNITY
        ------------------------------------------------- */

        .community {
            width: min(
                1120px,
                90%
            );

            margin:
                0 auto;

            padding:
                40px 0
                110px;
        }

        .community-card {
            position: relative;

            display: grid;

            grid-template-columns:
                1.2fr
                .8fr;

            gap: 30px;

            padding:
                45px;

            background:
                linear-gradient(
                    135deg,
                    rgba(
                        37,
                        16,
                        79,
                        .55
                    ),
                    rgba(
                        13,
                        12,
                        20,
                        .95
                    )
                );

            border:
                1px solid
                rgba(
                    139,
                    92,
                    246,
                    .22
                );

            border-radius: 18px;

            overflow: hidden;
        }

        .community-card h2 {
            margin-bottom: 13px;

            font-size:
                clamp(
                    25px,
                    4vw,
                    40px
                );

            letter-spacing:
                -1.5px;
        }

        .community-card p {
            max-width: 560px;

            color: #9993a5;

            font-size: 12px;

            line-height: 1.75;
        }

        .community-actions {
            display: flex;

            align-items: center;

            justify-content: flex-end;

            gap: 10px;
        }

        .community-actions a {
            padding:
                12px 17px;

            border-radius: 8px;

            font-size: 10px;

            font-weight: 800;
        }

        .discord-button {
            background:
                #5865f2;

            box-shadow:
                0 10px 30px
                rgba(
                    88,
                    101,
                    242,
                    .20
                );
        }

        .support-button {
            background:
                rgba(
                    255,
                    255,
                    255,
                    .04
                );

            border:
                1px solid
                #31293f;
        }

        /* -------------------------------------------------
           FINAL CTA
        ------------------------------------------------- */

        .final-cta {
            padding:
                105px 20px;

            text-align: center;
        }

        .final-cta h2 {
            margin-bottom: 13px;

            font-size:
                clamp(
                    32px,
                    5vw,
                    55px
                );

            letter-spacing:
                -2px;
        }

        .final-cta p {
            margin-bottom: 28px;

            color: #8f8999;

            font-size: 13px;
        }

        /* -------------------------------------------------
           FOOTER
        ------------------------------------------------- */

        footer {
            border-top:
                1px solid
                #1b1725;

            background:
                #08080d;
        }

        .footer-inner {
            width: min(
                1120px,
                90%
            );

            margin:
                0 auto;

            padding:
                55px 0
                25px;
        }

        .footer-top {
            display: grid;

            grid-template-columns:
                1.7fr
                1fr
                1fr
                1fr;

            gap: 40px;

            padding-bottom:
                40px;
        }

        .footer-brand {
            max-width: 300px;
        }

        .footer-brand-link {
            display: inline-flex;

            align-items: center;

            gap: 10px;

            margin-bottom: 14px;
        }

        .footer-brand-link img {
            width: 38px;
            height: 38px;

            object-fit: contain;

            border-radius: 9px;
        }

        .footer-brand-name {
            display: block;

            font-size: 14px;

            font-weight: 900;
        }

        .footer-brand-subtitle {
            display: block;

            margin-top: 2px;

            color: #766e82;

            font-size: 7px;

            font-weight: 800;

            letter-spacing: 1.3px;
        }

        .footer-brand p {
            color: #756e7f;

            font-size: 10px;

            line-height: 1.7;
        }

        .footer-column {
            display: flex;

            flex-direction: column;

            gap: 10px;
        }

        .footer-column h4 {
            margin-bottom: 5px;

            color: #ffffff;

            font-size: 10px;
        }

        .footer-column a {
            color: #70697a;

            font-size: 9px;

            transition:
                color .2s ease;
        }

        .footer-column a:hover {
            color: #c4b5fd;
        }

        .footer-bottom {
            display: flex;

            justify-content: space-between;

            gap: 20px;

            padding-top:
                22px;

            border-top:
                1px solid
                #17131f;

            color: #55505e;

            font-size: 8px;
        }

        /* -------------------------------------------------
           MOBILE
        ------------------------------------------------- */

        @media (max-width: 900px) {

            .nav-links {
                gap: 15px;

                margin-right: 15px;
            }

            .feature-grid {
                grid-template-columns:
                    repeat(
                        2,
                        1fr
                    );
            }

            .visual-window {
                grid-template-columns:
                    130px
                    1fr;
            }

            .community-card {
                grid-template-columns: 1fr;
            }

            .community-actions {
                justify-content:
                    flex-start;
            }

            .footer-top {
                grid-template-columns:
                    repeat(
                        2,
                        1fr
                    );
            }

        }

        @media (max-width: 650px) {

            .site-nav {
                height: 68px;

                padding:
                    0 18px;
            }

            .nav-links {
                display: none;
            }

            .hero {
                min-height: 760px;

                padding:
                    120px 20px
                    70px;
            }

            .hero h1 {
                letter-spacing:
                    -2.5px;
            }

            .hero-description {
                font-size: 13px;
            }

            .hero-actions {
                flex-direction: column;

                align-items: stretch;
            }

            .primary-button,
            .secondary-button {
                width: 100%;
            }

            .hero-visual {
                margin-top: 50px;
            }

            .visual-window {
                grid-template-columns: 1fr;
            }

            .visual-sidebar {
                display: none;
            }

            .visual-content {
                padding: 18px;
            }

            .visual-cards {
                grid-template-columns:
                    1fr;
            }

            .feature-grid {
                grid-template-columns: 1fr;
            }

            .how-visual {
                grid-template-columns: 1fr;

                padding: 40px 20px;
            }

            .how-line {
                display: none;
            }

            .stats-inner {
                grid-template-columns: 1fr;
            }

            .community-card {
                padding: 28px;
            }

            .community-actions {
                flex-direction: column;

                align-items: stretch;
            }

            .community-actions a {
                text-align: center;
            }

            .footer-top {
                grid-template-columns: 1fr;
            }

            .footer-bottom {
                flex-direction: column;
            }

        }

    </style>

</head>

<body>

    <!-- =================================================
         NAVBAR
    ================================================== -->

    <nav class="site-nav">

        <a
            href="/dashboard"
            class="nav-brand"
        >

            <img
                class="nav-logo"
                src="/dashboard/assets/btw-mechanic-logo.png"
                alt="BTW Mechanic"
            >

            <span class="nav-brand-text">

                <span class="nav-brand-name">
                    BTW Mechanic
                </span>

                <span class="nav-brand-subtitle">
                    BEYOND TWO WHEELS
                </span>

            </span>

        </a>

        <div class="nav-links">

            <a href="#features">
                Features
            </a>

            <a href="#how-it-works">
                How It Works
            </a>

            <a href="#reviews">
                Reviews
            </a>

            <a href="#community">
                Community
            </a>

        </div>

        <a
            class="nav-button"
            href="https://discord.com/oauth2/authorize?client_id=1535038083957919765&permissions=8&integration_type=0&scope=bot"
            target="_blank"
            rel="noopener noreferrer"
        >
            Add to Discord
        </a>

    </nav>


    <!-- =================================================
         HERO
    ================================================== -->

    <header class="hero">

        <div class="hero-content">

            <div class="hero-badge">

                <span class="hero-badge-dot"></span>

                BUILT FOR BEYOND TWO WHEELS

            </div>

            <h1>

                Your community.
                <br>

                Your wheels.
                <br>

                <span class="purple">
                    Your mechanic.
                </span>

            </h1>

            <p class="hero-description">

                Powerful Discord tools built specifically
                for the Beyond Two Wheels community.
                Keep your server organised, supported
                and connected with BTW Mechanic.

            </p>

            <div class="hero-actions">

                <a
                    class="primary-button"
                    href="https://discord.com/oauth2/authorize?client_id=1535038083957919765&permissions=8&integration_type=0&scope=bot"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Add to Discord
                </a>

                <a
                    class="secondary-button"
                    href="#features"
                >
                    Explore Features
                </a>

            </div>

            <!-- COMMUNITY + BOT PREVIEW -->

            <div class="hero-visual">

                <div class="community-preview">

                    <div class="discord-widget">

                        <iframe
                            src="https://discord.com/widget?id=1534313294138052818&theme=dark"
                            width="350"
                            height="500"
                            allowtransparency="true"
                            frameborder="0"
                            sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
                        ></iframe>

                    </div>


                    <div class="mechanic-preview">

                        <div class="mechanic-preview-badge">
                            <span></span>
                            BTW MECHANIC
                        </div>

                        <h3>
                            Your server's
                            <br>
                            <span class="purple">
                                digital mechanic.
                            </span>
                        </h3>

                        <p>
                            Built to handle the repetitive
                            work behind your Discord community,
                            so your staff can focus on what
                            actually matters.
                        </p>


                        <div class="mechanic-preview-features">

                            <div class="mechanic-preview-feature">

                                <div class="mechanic-feature-icon">
                                    🛡️
                                </div>

                                <div>
                                    <strong>
                                        Moderation
                                    </strong>

                                    <span>
                                        Keep things organised.
                                    </span>
                                </div>

                            </div>


                            <div class="mechanic-preview-feature">

                                <div class="mechanic-feature-icon">
                                    🎫
                                </div>

                                <div>
                                    <strong>
                                        Support
                                    </strong>

                                    <span>
                                        Help members when they need it.
                                    </span>
                                </div>

                            </div>


                            <div class="mechanic-preview-feature">

                                <div class="mechanic-feature-icon">
                                    📊
                                </div>

                                <div>
                                    <strong>
                                        Ranks & XP
                                    </strong>

                                    <span>
                                        Reward your community.
                                    </span>
                                </div>

                            </div>


                            <div class="mechanic-preview-feature">

                                <div class="mechanic-feature-icon">
                                    ⚙️
                                </div>

                                <div>
                                    <strong>
                                        Automation
                                    </strong>

                                    <span>
                                        Let the bot handle the busywork.
                                    </span>
                                </div>

                            </div>

                        </div>


                        <div class="mechanic-preview-status">

                            <span class="status-dot"></span>

                            <span>
                                BTW Mechanic is online
                            </span>

                        </div>

                    </div>

                </div>

            </div>

        </div>

    </header>


    <!-- =================================================
         FEATURES
    ================================================== -->

    <section
        class="section"
        id="features"
    >

        <div class="section-heading">

            <div class="eyebrow">
                EVERYTHING YOU NEED
            </div>

            <h2>
                One mechanic.
                <br>
                Plenty of tools.
            </h2>

            <p>
                BTW Mechanic brings the tools your
                Discord community needs together in
                one place, without the clutter.
            </p>

        </div>


        <div class="feature-grid">


            <article class="feature-card">

                <div class="feature-icon">
                    🛠️
                </div>

                <h3>
                    Moderation
                </h3>

                <p>
                    Keep the server clean, safe and
                    well-managed with powerful
                    moderation tools.
                </p>

            </article>


            <article class="feature-card">

                <div class="feature-icon">
                    🎫
                </div>

                <h3>
                    Modmail & Support
                </h3>

                <p>
                    Give members a private way to
                    contact the moderation team
                    whenever they need help.
                </p>

            </article>


            <article class="feature-card">

                <div class="feature-icon">
                    📊
                </div>

                <h3>
                    Ranks & XP
                </h3>

                <p>
                    Reward active members with XP,
                    ranks and progression as they
                    participate in the community.
                </p>

            </article>


            <article class="feature-card">

                <div class="feature-icon">
                    🎉
                </div>

                <h3>
                    Events & Community
                </h3>

                <p>
                    Make community events, giveaways
                    and announcements easier to
                    organise and manage.
                </p>

            </article>


            <article class="feature-card">

                <div class="feature-icon">
                    🤖
                </div>

                <h3>
                    Server Utilities
                </h3>

                <p>
                    Automation, member management,
                    useful commands and tools for
                    keeping your server running.
                </p>

            </article>


            <article class="feature-card">

                <div class="feature-icon">
                    📋
                </div>

                <h3>
                    Logging
                </h3>

                <p>
                    Keep important server activity
                    organised and easy for staff
                    to keep track of.
                </p>

            </article>


        </div>

    </section>


    <!-- =================================================
         HOW IT WORKS
    ================================================== -->

    <section
        class="how-section"
        id="how-it-works"
    >

        <div class="section-heading">

            <div class="eyebrow">
                SIMPLE BY DESIGN
            </div>

            <h2>
                Your server.
                <br>
                Running smoother.
            </h2>

            <p>
                BTW Mechanic works quietly in the
                background while giving your staff
                the tools they need to manage the
                community.
            </p>

        </div>


        <div class="how-visual">

            <div class="how-line"></div>


            <div class="how-step">

                <div class="how-number">
                    01
                </div>

                <h3>
                    Add BTW Mechanic
                </h3>

                <p>
                    Invite the bot to your Discord
                    server and get everything connected.
                </p>

            </div>


            <div class="how-step">

                <div class="how-number">
                    02
                </div>

                <h3>
                    Configure your tools
                </h3>

                <p>
                    Choose the moderation, support,
                    ranks, events and utilities your
                    community needs.
                </p>

            </div>


            <div class="how-step">

                <div class="how-number">
                    03
                </div>

                <h3>
                    Let it work
                </h3>

                <p>
                    BTW Mechanic handles the repetitive
                    work while your community keeps moving.
                </p>

            </div>


        </div>

    </section>


    <!-- =================================================
         COMMUNITY STATS
    ================================================== -->

    <section class="stats-section">

        <div class="stats-inner">

            <div>

                <div class="stat-number">
                    1
                </div>

                <div class="stat-label">
                    COMMUNITY
                </div>

            </div>


            <div>

                <div class="stat-number">
                    100+
                </div>

                <div class="stat-label">
                    COMMANDS & TOOLS
                </div>

            </div>


            <div>

                <div class="stat-number">
                    24/7
                </div>

                <div class="stat-label">
                    BOT AVAILABILITY
                </div>

            </div>

        </div>

    </section>


    <!-- =================================================
         REVIEWS
    ================================================== -->

    <section
        class="reviews-section"
        id="reviews"
    >

        <div class="reviews-heading">

            <div class="eyebrow">
                COMMUNITY REVIEWS
            </div>

            <div class="section-heading">

                <h2>
                    Don't just take
                    our word for it.
                </h2>

                <p>
                    Real feedback from the people
                    using BTW Mechanic.
                </p>

            </div>

        </div>


        <div class="review-track-wrapper">

            <div class="review-track">


                <!-- REVIEW 1 -->

                <article class="review-card">

                    <div class="review-top">

                        <div class="review-avatar">
                            ?
                        </div>

                        <div class="review-user">

                            <div class="review-username">
                                Your Username
                            </div>

                            <div class="review-date">
                                16 Aug 2026 · 18:42
                            </div>

                        </div>

                        <div class="review-stars">
                            ★★★★★
                        </div>

                    </div>

                    <p class="review-note">
                        Your testimonial goes here.
                        Replace this with a real review
                        from your community.
                    </p>

                </article>


                <!-- REVIEW 2 -->

                <article class="review-card">

                    <div class="review-top">

                        <div class="review-avatar">
                            ?
                        </div>

                        <div class="review-user">

                            <div class="review-username">
                                Your Username
                            </div>

                            <div class="review-date">
                                15 Aug 2026 · 14:20
                            </div>

                        </div>

                        <div class="review-stars">
                            ★★★★★
                        </div>

                    </div>

                    <p class="review-note">
                        Your testimonial goes here.
                        Replace this with a real review
                        from your community.
                    </p>

                </article>


                <!-- REVIEW 3 -->

                <article class="review-card">

                    <div class="review-top">

                        <div class="review-avatar">
                            ?
                        </div>

                        <div class="review-user">

                            <div class="review-username">
                                Your Username
                            </div>

                            <div class="review-date">
                                14 Aug 2026 · 20:05
                            </div>

                        </div>

                        <div class="review-stars">
                            ★★★★★
                        </div>

                    </div>

                    <p class="review-note">
                        Your testimonial goes here.
                        Replace this with a real review
                        from your community.
                    </p>

                </article>


                <!-- REVIEW 4 -->

                <article class="review-card">

                    <div class="review-top">

                        <div class="review-avatar">
                            ?
                        </div>

                        <div class="review-user">

                            <div class="review-username">
                                Your Username
                            </div>

                            <div class="review-date">
                                13 Aug 2026 · 17:31
                            </div>

                        </div>

                        <div class="review-stars">
                            ★★★★★
                        </div>

                    </div>

                    <p class="review-note">
                        Your testimonial goes here.
                        Replace this with a real review
                        from your community.
                    </p>

                </article>


                <!-- DUPLICATES FOR SMOOTH LOOP -->


                <article class="review-card">

                    <div class="review-top">

                        <div class="review-avatar">
                            ?
                        </div>

                        <div class="review-user">

                            <div class="review-username">
                                Your Username
                            </div>

                            <div class="review-date">
                                16 Aug 2026 · 18:42
                            </div>

                        </div>

                        <div class="review-stars">
                            ★★★★★
                        </div>

                    </div>

                    <p class="review-note">
                        Your testimonial goes here.
                        Replace this with a real review
                        from your community.
                    </p>

                </article>


                <article class="review-card">

                    <div class="review-top">

                        <div class="review-avatar">
                            ?
                        </div>

                        <div class="review-user">

                            <div class="review-username">
                                Your Username
                            </div>

                            <div class="review-date">
                                15 Aug 2026 · 14:20
                            </div>

                        </div>

                        <div class="review-stars">
                            ★★★★★
                        </div>

                    </div>

                    <p class="review-note">
                        Your testimonial goes here.
                        Replace this with a real review
                        from your community.
                    </p>

                </article>


                <article class="review-card">

                    <div class="review-top">

                        <div class="review-avatar">
                            ?
                        </div>

                        <div class="review-user">

                            <div class="review-username">
                                Your Username
                            </div>

                            <div class="review-date">
                                14 Aug 2026 · 20:05
                            </div>

                        </div>

                        <div class="review-stars">
                            ★★★★★
                        </div>

                    </div>

                    <p class="review-note">
                        Your testimonial goes here.
                        Replace this with a real review
                        from your community.
                    </p>

                </article>


                <article class="review-card">

                    <div class="review-top">

                        <div class="review-avatar">
                            ?
                        </div>

                        <div class="review-user">

                            <div class="review-username">
                                Your Username
                            </div>

                            <div class="review-date">
                                13 Aug 2026 · 17:31
                            </div>

                        </div>

                        <div class="review-stars">
                            ★★★★★
                        </div>

                    </div>

                    <p class="review-note">
                        Your testimonial goes here.
                        Replace this with a real review
                        from your community.
                    </p>

                </article>


            </div>

        </div>

    </section>


    <!-- =================================================
         COMMUNITY
    ================================================== -->

    <section
        class="community"
        id="community"
    >

        <div class="community-card">

            <div>

                <div class="eyebrow">
                    BEYOND TWO WHEELS
                </div>

                <h2>
                    Built around
                    <br>
                    the community.
                </h2>

                <p>
                    BTW Mechanic was created to serve
                    Beyond Two Wheels — bringing useful
                    tools, automation and community
                    features together in one place.
                </p>

            </div>


            <div class="community-actions">

                <a
                    class="discord-button"
                    href="https://discord.gg/wUGdq9fqDX"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Join Beyond Two Wheels
                </a>

                <a
                    class="support-button"
                    href="https://discord.gg/wtrjtFBmag"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Support Server
                </a>

            </div>

        </div>

    </section>


    <!-- =================================================
         FINAL CTA
    ================================================== -->

    <section class="final-cta">

        <div class="eyebrow">
            READY TO GET STARTED?
        </div>

        <h2>
            Give your server
            <br>
            a mechanic.
        </h2>

        <p>
            Add BTW Mechanic to your Discord server
            and start building a better community.
        </p>

        <a
            class="primary-button"
            href="https://discord.com/oauth2/authorize?client_id=1535038083957919765&permissions=8&integration_type=0&scope=bot"
            target="_blank"
            rel="noopener noreferrer"
        >
            Add BTW Mechanic
        </a>

    </section>


    <!-- =================================================
         FOOTER
    ================================================== -->

    <footer>

        <div class="footer-inner">

            <div class="footer-top">


                <div class="footer-brand">

                    <a
                        href="/dashboard"
                        class="footer-brand-link"
                    >

                        <img
                            src="/dashboard/assets/btw-mechanic-logo.png"
                            alt="BTW Mechanic"
                        >

                        <span>

                            <span class="footer-brand-name">
                                BTW Mechanic
                            </span>

                            <span class="footer-brand-subtitle">
                                BEYOND TWO WHEELS
                            </span>

                        </span>

                    </a>

                    <p>
                        Serving the Beyond Two Wheels
                        Community, one crank at a time.
                    </p>

                </div>


                <div class="footer-column">

                    <h4>
                        Navigate
                    </h4>

                    <a href="#features">
                        Features
                    </a>

                    <a href="#how-it-works">
                        How It Works
                    </a>

                    <a href="#reviews">
                        Reviews
                    </a>

                    <a href="#community">
                        Community
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