const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

// Configuração do Socket.IO com CORS
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    allowEIO3: true,
    transports: ['websocket', 'polling']
});

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Rota principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Estrutura de dados
const servers = new Map();
const channels = new Map();

function generateId() {
    return crypto.randomBytes(8).toString('hex');
}

// Socket.IO - Gerenciamento de conexões
io.on('connection', (socket) => {
    console.log('Novo cliente conectado:', socket.id);

    socket.on('create-server', (serverName) => {
        const serverId = generateId();
        const channelId = generateId();
        
        const defaultChannel = {
            id: channelId,
            name: 'geral',
            serverId: serverId,
            users: new Set()
        };
        
        const newServer = {
            id: serverId,
            name: serverName || 'Servidor',
            channels: new Map([[channelId, defaultChannel]])
        };
        
        servers.set(serverId, newServer);
        channels.set(channelId, defaultChannel);
        
        socket.emit('server-created', { serverId, serverName: newServer.name });
    });

    socket.on('join-server', (serverId) => {
        const server = servers.get(serverId);
        if (server) {
            socket.join(serverId);
            socket.emit('server-info', {
                id: server.id,
                name: server.name,
                channels: Array.from(server.channels.values()).map(c => ({ 
                    id: c.id, 
                    name: c.name 
                }))
            });
        } else {
            socket.emit('error', 'Servidor não encontrado');
        }
    });

    socket.on('create-channel', (data) => {
        const { serverId, channelName } = data;
        const server = servers.get(serverId);
        if (server) {
            const channelId = generateId();
            const newChannel = {
                id: channelId,
                name: channelName || 'novo-canal',
                serverId: serverId,
                users: new Set()
            };
            
            server.channels.set(channelId, newChannel);
            channels.set(channelId, newChannel);
            
            io.to(serverId).emit('channel-created', { 
                id: channelId, 
                name: newChannel.name 
            });
        }
    });

    socket.on('join-channel', (data) => {
        const { channelId } = data;
        const channel = channels.get(channelId);
        if (channel) {
            socket.join(channelId);
            channel.users.add(socket.id);
            
            socket.to(channelId).emit('user-joined', { userId: socket.id });
            
            const userList = Array.from(channel.users);
            socket.emit('user-list', userList);
            
            const existingStreamers = Array.from(channel.users).filter(
                id => id !== socket.id
            );
            if (existingStreamers.length > 0) {
                socket.emit('existing-streamers', existingStreamers);
            }
        }
    });

    socket.on('leave-channel', (channelId) => {
        const channel = channels.get(channelId);
        if (channel) {
            channel.users.delete(socket.id);
            socket.leave(channelId);
            socket.to(channelId).emit('user-left', socket.id);
        }
    });

    socket.on('offer', (data) => {
        if (data.to) {
            socket.to(data.to).emit('offer', {
                offer: data.offer,
                from: socket.id
            });
        } else if (data.channelId) {
            socket.to(data.channelId).emit('offer', {
                offer: data.offer,
                from: socket.id
            });
        }
    });

    socket.on('answer', (data) => {
        socket.to(data.to).emit('answer', {
            answer: data.answer,
            from: socket.id
        });
    });

    socket.on('ice-candidate', (data) => {
        socket.to(data.to).emit('ice-candidate', {
            candidate: data.candidate,
            from: socket.id
        });
    });

    socket.on('start-stream', (data) => {
        socket.to(data.channelId).emit('stream-started', { 
            userId: socket.id 
        });
    });

    socket.on('stop-stream', (data) => {
        socket.to(data.channelId).emit('stream-stopped', { 
            userId: socket.id 
        });
    });

    socket.on('disconnect', () => {
        channels.forEach((channel, channelId) => {
            if (channel.users.has(socket.id)) {
                channel.users.delete(socket.id);
                socket.to(channelId).emit('user-left', socket.id);
            }
        });
        console.log('Cliente desconectado:', socket.id);
    });
});

// Prevenção de múltiplos listen
let isListening = false;

function startServer() {
    if (isListening) {
        console.log('Servidor já está rodando!');
        return;
    }

    const PORT = process.env.PORT || 10000;
    
    try {
        server.listen(PORT, '0.0.0.0', () => {
            isListening = true;
            console.log(`✅ Servidor rodando na porta ${PORT}`);
            console.log(`📱 Acesse: http://localhost:${PORT}`);
        });

        // Tratamento de erros
        server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                console.error(`❌ Porta ${PORT} já está em uso!`);
                console.log('Tentando porta alternativa...');
                
                // Tentar próxima porta
                const newPort = parseInt(PORT) + 1;
                server.listen(newPort, '0.0.0.0', () => {
                    isListening = true;
                    console.log(`✅ Servidor rodando na porta ${newPort}`);
                });
            } else {
                console.error('Erro no servidor:', error);
            }
        });

    } catch (error) {
        console.error('Erro ao iniciar servidor:', error);
    }
}

// Iniciar servidor apenas uma vez
startServer();

// Manter o servidor ativo no Render
setInterval(() => {
    console.log('💓 Keep alive -', new Date().toISOString());
}, 300000); // A cada 5 minutos

// Tratamento de erros não capturados
process.on('uncaughtException', (error) => {
    console.error('Erro não capturado:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Promise rejeitada:', error);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Recebido SIGTERM. Encerrando graciosamente...');
    server.close(() => {
        console.log('Servidor encerrado');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('Recebido SIGINT. Encerrando...');
    server.close(() => {
        console.log('Servidor encerrado');
        process.exit(0);
    });
});
