const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Armazenamento
const servers = new Map(); // serverId -> { id, name, users: Set() }

function generateId() {
    return crypto.randomBytes(4).toString('hex');
}

io.on('connection', (socket) => {
    console.log('✅ Novo cliente conectado:', socket.id);

    // CRIAR SERVIDOR
    socket.on('create-server', (serverName) => {
        const serverId = generateId();
        
        const newServer = {
            id: serverId,
            name: serverName || 'Servidor',
            users: new Set([socket.id])
        };
        
        servers.set(serverId, newServer);
        socket.join(serverId);
        socket.data.serverId = serverId;
        
        socket.emit('server-created', { 
            serverId: serverId, 
            serverName: newServer.name 
        });
        
        console.log('✅ Servidor criado:', serverId);
    });

    // ENTRAR EM SERVIDOR
    socket.on('join-server', (serverId) => {
        const server = servers.get(serverId);
        
        if (server) {
            socket.join(serverId);
            server.users.add(socket.id);
            socket.data.serverId = serverId;
            
            // Enviar informações do servidor
            socket.emit('server-info', {
                id: server.id,
                name: server.name
            });
            
            // Notificar outros usuários
            socket.to(serverId).emit('user-joined', { 
                userId: socket.id,
                userList: Array.from(server.users)
            });
            
            // Enviar lista de usuários existentes para o novo usuário
            const existingUsers = Array.from(server.users).filter(id => id !== socket.id);
            if (existingUsers.length > 0) {
                socket.emit('existing-users', existingUsers);
            }
            
            console.log('✅ Cliente entrou no servidor:', serverId);
            console.log('👥 Usuários no servidor:', server.users.size);
        } else {
            socket.emit('error', 'Servidor não encontrado');
        }
    });

    // WEBRTC SINALIZAÇÃO
    socket.on('offer', (data) => {
        if (data.to) {
            socket.to(data.to).emit('offer', {
                offer: data.offer,
                from: socket.id
            });
        }
    });

    socket.on('answer', (data) => {
        if (data.to) {
            socket.to(data.to).emit('answer', {
                answer: data.answer,
                from: socket.id
            });
        }
    });

    socket.on('ice-candidate', (data) => {
        if (data.to) {
            socket.to(data.to).emit('ice-candidate', {
                candidate: data.candidate,
                from: socket.id
            });
        }
    });

    socket.on('start-stream', (data) => {
        const serverId = socket.data.serverId;
        if (serverId) {
            socket.to(serverId).emit('stream-started', { 
                userId: socket.id 
            });
        }
    });

    socket.on('stop-stream', (data) => {
        const serverId = socket.data.serverId;
        if (serverId) {
            socket.to(serverId).emit('stream-stopped', { 
                userId: socket.id 
            });
        }
    });

    // DESCONECTAR
    socket.on('disconnect', () => {
        console.log('❌ Cliente desconectado:', socket.id);
        
        const serverId = socket.data.serverId;
        if (serverId) {
            const server = servers.get(serverId);
            if (server) {
                server.users.delete(socket.id);
                socket.to(serverId).emit('user-left', socket.id);
                
                // Remover servidor se vazio
                if (server.users.size === 0) {
                    servers.delete(serverId);
                    console.log('🗑️ Servidor removido:', serverId);
                }
            }
        }
    });
});

let isListening = false;

function startServer() {
    if (isListening) return;

    const PORT = process.env.PORT || 10000;
    
    try {
        server.listen(PORT, '0.0.0.0', () => {
            isListening = true;
            console.log('✅ Servidor rodando na porta', PORT);
        });

        server.on('error', (error) => {
            console.error('❌ Erro no servidor:', error);
        });

    } catch (error) {
        console.error('❌ Erro ao iniciar:', error);
    }
}

startServer();

setInterval(() => {
    console.log('💓 Keep alive -', new Date().toISOString());
}, 300000);

process.on('uncaughtException', (error) => {
    console.error('❌ Erro não capturado:', error);
});

process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
});
