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

function getDiscordOAuthUrl() {
    const params = new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        response_type: 'code',
        redirect_uri: process.env.DISCORD_REDIRECT_URI,
        scope: 'identify guilds',
    });

    return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

router.get('/', (req, res) => {
    const bot = req.app.locals.bot;

    if (req.session.user) {
        const user = req.session.user;

        const username = escapeHtml(
            user.global_name || user.username || 'User'
        );

        const userId = escapeHtml(user.id);

        const avatarUrl = user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
            : null;

        const avatar = avatarUrl
            ? `<img class="avatar" src="${avatarUrl}" alt="Profile picture">`
            : `<div class="avatar avatar-fallback">${escapeHtml(
                  (user.username || 'U').charAt(0).toUpperCase()
              )}</div>`;

        return res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>BTW Mechanic Dashboard</title>

    <style>
        * {
            box-sizing: border-box;
        }

        html,
        body {
            margin: 0;
            padding: 0;
            min-height: 100%;
        }

        body {
            font-family: Arial, sans-serif;
            background:
                radial-gradient(
                    circle at top right,
                    #24104f 0%,
                    #090910 45%,
                    #050509 100%
                );
            color: white;
            min-height: 100vh;
            overflow-x: hidden;
        }

        /* =========================
           SIDEBAR
        ========================= */

        .sidebar {
            position: fixed;
            left: 0;
            top: 0;
            bottom: 0;

            width: 240px;

            background: rgba(10, 10, 18, 0.94);
            border-right: 1px solid #242438;

            padding: 24px 18px;

            display: flex;
            flex-direction: column;

            z-index: 100;
        }

        .brand {
            font-size: 22px;
            font-weight: bold;
            color: #ffffff;
            letter-spacing: 0.5px;
        }

        /* =========================
           ACCOUNT / PROFILE
        ========================= */

        .account {
            position: relative;

            margin-top: auto;

            width: 100%;

            background: #1f2937;
            border: 1px solid #2f3b50;

            padding: 12px;

            border-radius: 14px;

            cursor: pointer;

            transition: 0.2s ease;

            z-index: 200;
        }

        .account:hover {
            background: #242438;
            border-color: #7c3aed;
        }

        .account-main {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .avatar {
            width: 38px;
            height: 38px;

            border-radius: 50%;

            object-fit: cover;

            flex-shrink: 0;
        }

        .avatar-fallback {
            display: flex;
            align-items: center;
            justify-content: center;

            background: #d65c9c;
            color: white;

            font-weight: bold;
            font-size: 16px;
        }

        .account-info {
            min-width: 0;
        }

        .account h2 {
            font-size: 14px;
            margin: 0;

            color: #ffffff;

            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .account p {
            font-size: 11px;
            color: #8f8fa3;
            margin: 3px 0 0;
        }

        /* =========================
           ACCOUNT MENU
        ========================= */

        .account-menu {
            display: none;

            position: absolute;

            left: 0;
            bottom: calc(100% + 10px);

            width: 100%;

            padding: 12px;

            background: #242438;

            border: 1px solid #7c3aed;
            border-radius: 12px;

            box-shadow: 0 12px 35px rgba(0, 0, 0, 0.45);

            z-index: 300;
        }

        .account-menu.open {
            display: block;
        }

        .account-menu .discord-id {
            padding: 8px 4px 12px;

            margin: 0 0 8px;

            border-bottom: 1px solid #3a3a52;

            color: #8f8fa3;
            font-size: 11px;

            word-break: break-all;
        }

        .account-menu .discord-id strong {
            color: #ffffff;
            display: block;
            margin-top: 4px;
            font-size: 12px;
        }

        .account-menu a {
            display: block;

            color: #ffffff;

            text-decoration: none;

            padding: 9px 8px;

            font-size: 13px;

            border-radius: 7px;

            transition: 0.15s ease;
        }

        .account-menu a:hover {
            background: #34344d;
        }

        /* =========================
           MAIN CONTENT
        ========================= */

        .container {
            margin-left: 240px;

            width: calc(100% - 240px);

            max-width: 1400px;

            padding: 50px 60px 80px;

            min-height: 100vh;
        }

        h1 {
            margin: 0 0 10px;

            font-size: 34px;
        }

        .subtitle {
            color: #a1a1aa;

            margin: 0 0 35px;

            font-size: 15px;
        }

        /* =========================
           CARDS
        ========================= */

        .grid {
            display: grid;

            grid-template-columns:
                repeat(auto-fit, minmax(260px, 1fr));

            gap: 24px;

            width: 100%;
        }

        .card {
            background: #0f111a;

            padding: 30px;

            border-radius: 16px;

            border: 1px solid #2a1748;

            box-shadow:
                0 8px 35px rgba(124, 58, 237, 0.22);

            min-height: 150px;
        }

        .card h2 {
            margin: 0 0 10px;

            font-size: 18px;

            color: #f4f4f5;
        }

        .value {
            font-size: 24px;

            font-weight: bold;

            margin-top: 15px;

            color: #ffffff;
        }

        .online {
            color: #22c55e;

            text-shadow:
                0 0 12px rgba(34, 197, 94, 0.4);
        }

        /* =========================
           MOBILE
        ========================= */

        @media (max-width: 700px) {
            .sidebar {
                width: 210px;
            }

            .container {
                margin-left: 210px;
                width: calc(100% - 210px);

                padding: 35px 25px 70px;
            }

            .grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>

<body>

    <aside class="sidebar">

        <div class="brand">
            ⚙️ BTW Mechanic
        </div>

        <div
            class="account"
            id="account"
            onclick="toggleAccountMenu(event)"
        >

            <div class="account-main">

                ${avatar}

                <div class="account-info">
                    <h2>${username}</h2>

                    <p>
                        Logged in as ${username}
                    </p>
                </div>

            </div>

            <div
                class="account-menu"
                id="accountMenu"
            >

                <div class="discord-id">
                    Discord ID:

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

    </aside>

    <main class="container">

        <h1>
            Dashboard
        </h1>

        <p class="subtitle">
            Manage your BTW Mechanic Discord bot.
        </p>

        <div class="grid">

            <div class="card">

                <h2>
                    🤖 Bot Status
                </h2>

                <div class="value online">
                    ${bot?.isReady()
                        ? '🟢 Online'
                        : '🔴 Offline'}
                </div>

            </div>

            <div class="card">

                <h2>
                    ⚙️ Bot
                </h2>

                <div class="value">
                    BTW Mechanic
                </div>

            </div>

            <div class="card">

                <h2>
                    🔐 Authentication
                </h2>

                <div class="value">
                    ✅ Connected
                </div>

            </div>

        </div>

    </main>

    <script>
        function toggleAccountMenu(event) {
            event.stopPropagation();

            const menu = document.getElementById('accountMenu');

            menu.classList.toggle('open');
        }

        document.addEventListener('click', function () {
            const menu = document.getElementById('accountMenu');

            if (menu) {
                menu.classList.remove('open');
            }
        });

        document
            .getElementById('accountMenu')
            .addEventListener('click', function (event) {
                event.stopPropagation();
            });
    </script>

</body>
</html>
        `);
    }

    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>BTW Mechanic</title>

    <style>
        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;

            font-family: Arial, sans-serif;

            background:
                radial-gradient(
                    circle at top right,
                    #24104f 0%,
                    #090910 45%,
                    #050509 100%
                );

            color: white;

            display: flex;
            align-items: center;
            justify-content: center;

            min-height: 100vh;
        }

        .login-card {
            background: rgba(15, 15, 30, 0.85);

            padding: 45px;

            border-radius: 16px;

            width: 90%;
            max-width: 500px;

            text-align: center;

            border: 1px solid #2a1748;

            box-shadow:
                0 8px 35px rgba(124, 58, 237, 0.22);
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

router.get('/auth/discord', (req, res) => {
    res.redirect(getDiscordOAuthUrl());
});

router.get('/auth/discord/callback', async (req, res) => {
    try {
        const { code } = req.query;

        if (!code) {
            return res
                .status(400)
                .send('Missing Discord authorization code.');
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

                    code,

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
                .send('Discord login failed.');
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

        res.redirect('/dashboard');

    } catch (error) {
        console.error(
            'Discord OAuth error:',
            error
        );

        res
            .status(500)
            .send(
                'Something went wrong while logging in with Discord.'
            );
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/dashboard');
    });
});

function escapeHtml(value = '') {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

export default router;