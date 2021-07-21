import crypto from 'crypto';
import ssh from 'ssh2';
import sshpk from 'sshpk';
import Config from '../config.js';
import Transport from '../transport/index.js';
import TunnelService from '../tunnel/tunnel-service.js';
import Version from '../version.js';
import { Logger } from '../logger.js';

const logger = Logger("ssh-transport-endpoint");

const sshBanner = `exposr/${Version.version.version}`;

class SSHEndpoint {
    constructor(opts) {
        this.opts = opts;
        this.tunnelService = new TunnelService();
        this._clients = [];

        const generateHostKey = () => {
            const keys = crypto.generateKeyPairSync('rsa', {
                modulusLength: 2048,
                publicKeyEncoding: {
                    type: 'spki',
                    format: 'pem',
                },
                privateKeyEncoding: {
                    type: 'pkcs8',
                    format: 'pem',
                }
            });

            const key = sshpk.parsePrivateKey(keys.privateKey, 'pem');
            return key.toString('ssh');
        };

        this._hostkey = opts.hostKey || generateHostKey();
        this._fingerprint = sshpk.parsePrivateKey(this._hostkey).fingerprint().toString();

        const server = this._server = new ssh.Server({
            hostKeys: [this._hostkey],
            banner: sshBanner,
        });

        server.on('connection', (client, clientInfo) => {
            logger.info({
                operation: 'connection',
                info: {
                    ip: clientInfo.ip,
                    port: clientInfo.port,
                    ident: clientInfo.identRaw,
                },
            })
            this._handleClient(client, clientInfo);
        });

        server.listen(Config.get('transport-ssh-port'), (err) => {
            if (err) {
                throw err;
            } else {
                logger.info({
                    msg: 'SSH transport endpoint initialized',
                    fingerprint: this._fingerprint
                });
            }
        });
    }

    destroy() {
        this._server.close();
    }

    getEndpoint(tunnel, baseUrl) {
        const host = this.opts.host ?? baseUrl.hostname;
        const port = this.opts.port;
        const username = tunnel.id;
        const password = tunnel.endpoints.token;
        const url = `ssh://${username}:${password}@${host}:${port}`;
        const fingerprint = this._fingerprint;

        return {
            host,
            port,
            username,
            password,
            url,
            fingerprint,
        };
    }

    static _safeEqual(input, allowed) {
        const autoReject = (input.length !== allowed.length);
        if (autoReject) {
          allowed = input;
        }
        const isMatch = crypto.timingSafeEqual(Buffer.from(input), Buffer.from(allowed));
        return (!autoReject && isMatch);
    }

    _handleClient(client, info) {
        let tunnel;
        client.on('authentication', async (ctx) => {
            const [tunnelId, token] = ctx.username.split(':');
            tunnel = await this.tunnelService.get(tunnelId);

            if (!SSHEndpoint._safeEqual(token, tunnel.endpoints?.token || '')) {
                ctx.reject();
                client.end();
                return;
            } else {
                ctx.accept();
            }
        });

        client.on('ready', async (ctx) => {
            const transport = Transport.createTransport({
                method: 'SSH',
                opts: {
                    tunnelId: tunnel.id,
                    upstream: tunnel.upstream.url,
                    client,
                }
            });
            const res = await this.tunnelService.connect(tunnel.id, transport, {
                peer: info.ip,
            });
            if (!res) {
                logger
                    .withContext("tunnel", tunnel.id)
                    .error({
                        operation: 'transport_connect',
                        msg: 'failed to connect transport'
                    });
                transport.destroy();
            }

        });
    }
}

export default SSHEndpoint;