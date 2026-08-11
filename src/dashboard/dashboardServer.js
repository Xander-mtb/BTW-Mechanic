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
    if (req.session.user) {
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>BTW Mechanic Dashboard</title>
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
                        background: #1f2937;
                        padding: 40px;
                        border-radius: 16px;
                        width: 90%;
                        max-width: 600px;
                        text-align: center;
                    }

                    a {
                        color: white;
                        text-decoration: none;
                    }

                    .button {
                        display: inline-block;
                        margin-top: 20px;
                        padding: 12px 24px;
                        background: #5865F2;
                        border-radius: 8px;
                    }
                </style>
            </head>

            <body>
                <div class="card">
                    <h1>⚙️ BTW Mechanic</h1>

                    <p>
                        Welcome back,
                        <strong>${escapeHtml(req.session.user.username)}</strong>!
                    </p>

                    <p>
                        You are successfully logged into the dashboard.
                    </p>

                    <a class="button" href="/dashboard/logout">
                        Logout
                    </a>
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
                    background: #1f2937;
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