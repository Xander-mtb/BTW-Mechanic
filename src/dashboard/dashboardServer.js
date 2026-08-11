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
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>BTW Mechanic Dashboard</title>
                        <style>
            * {
                box-sizing: border-box;
            }

            body {
                margin: 0;
                font-family: Arial, sans-serif;
               background: radial-gradient(circle at top right, #24104f 0%, #090910 45%, #050509 100%);
                color: white;
                min-height: 100vh;
            }
                    .sidebar {
    background: rgba(10, 10, 18, 0.85);
    border-bottom: 1px solid #2a1748;
    padding: 24px 18px;
    width: 240px;
    min-height: 100vh;
    position: fixed;
    left: 0;
    top: 0;

    display: flex;
    flex-direction: column;
    gap: 24px;
    border-right: 1px solid #242438;
}

                    .brand {
    font-size: 22px;
    font-weight: bold;
    color: #ffffff;
    letter-spacing: 0.5px;
}
                    }

                    .logout {
    margin-top: auto;
    background: #6d28d9;
    color: white;
    text-decoration: none;
    padding: 10px 18px;
    border-radius: 8px;
    transition: 0.2s;
}

.logout:hover {
    background: #7c3aed;
}

                    .container {
    max-width: 1200px;
    margin: 50px 40px 50px 280px;
    padding: 20px;
}

                    .subtitle {
    color: #a1a1aa;
    margin-bottom: 30px;
    font-size: 15px;
}

                    .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 24px;
}

                    .card {
    background: #0f111a;
    padding: 30px;
    border-radius: 16px;
    border: 1px solid #2a1748;
    box-shadow: 0 8px 35px rgba(124, 58, 237, 0.22);
}

                    .card h2 {
    margin-top: 0;
    margin-bottom: 10px;
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
    text-shadow: 0 0 12px rgba(34, 197, 94, 0.4);
}
                    .account {
                        margin-top: 20px;
                        background: #1f2937;
                        padding: 25px;
                        border-radius: 12px;
                    }
                </style>
            </head>

            <body>
                <div class="sidebar">
                    <div class="brand">⚙️ BTW Mechanic</div>

                    <a class="logout" href="/dashboard/logout">
                        Logout
                    </a>
                </div>

                <div class="container">
                    <h1>Dashboard</h1>

                    <p class="subtitle">
                        Manage your BTW Mechanic Discord bot.
                    </p>

                    <div class="grid">
                        <div class="card">
                            <h2>🤖 Bot Status</h2>
                            <div class="value online">
                                ${bot?.isReady() ? '🟢 Online' : '🔴 Offline'}
                            </div>
                        </div>

                        <div class="card">
                            <h2>⚙️ Bot</h2>
                            <div class="value">
                                BTWBot
                            </div>
                        </div>

                        <div class="card">
                            <h2>🔐 Authentication</h2>
                            <div class="value">
                                ✅ Connected
                            </div>
                        </div>
                    </div>

                    <div class="account">
                        <h2>👤 Your Account</h2>

                        <p>
                            Logged in as
                            <strong>${escapeHtml(req.session.user.username)}</strong>
                        </p>

                        <p>
                            Discord ID:
                            <strong>${escapeHtml(req.session.user.id)}</strong>
                        </p>
                    </div>
                </div>
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
                body {
                    margin: 0;
                    font-family: Arial, sans-serif;
                    background: #111827;
                    color: white;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 100vh;
                }

                .card {
                    background: rgba(15, 15, 30, 0.75);
                    padding: 45px;
                    border-radius: 16px;
                    width: 90%;
                    max-width: 500px;
                    text-align: center;
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
            </style>
        </head>

        <body>
            <div class="card">
                <div class="logo">⚙️</div>

                <h1>BTW Mechanic</h1>

                <p>
                    Manage your Discord bot from one simple dashboard.
                </p>

                <a class="login" href="/dashboard/auth/discord">
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
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    client_id: process.env.DISCORD_CLIENT_ID,
                    client_secret: process.env.DISCORD_CLIENT_SECRET,
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: process.env.DISCORD_REDIRECT_URI,
                }),
            }
        );

        const tokenData = await tokenResponse.json();

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

        const user = await userResponse.json();

        if (!userResponse.ok) {
            console.error(
                'Discord user error:',
                user
            );

            return res
                .status(500)
                .send('Discord login failed while getting your user information.');
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
            .send('Something went wrong while logging in with Discord.');
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