const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static(path.join(__dirname, 'public')));

const lobbies = {};

io.on('connection', (socket) => {
    socket.on('joinLobby', ({ lobbyId, userName, isHost }) => {
        socket.join(lobbyId);
        socket.lobbyId = lobbyId;
        socket.userName = userName;
        socket.isHost = isHost;
        socket.updateInterval = 5000;

        if (!lobbies[lobbyId]) lobbies[lobbyId] = {};
        lobbies[lobbyId][socket.id] = { name: userName, location: null, interval: 5000 };

        io.to(lobbyId).emit('userList', lobbies[lobbyId]);
    });

    socket.on('locationUpdate', (location) => {
        const lobby = lobbies[socket.lobbyId];
        if (lobby && lobby[socket.id]) {
            lobby[socket.id].location = location;
            io.to(socket.lobbyId).emit('userList', lobby);
        }
    });

    socket.on('setUpdateInterval', (interval) => {
        if (socket.isHost) {
            for (const id in lobbies[socket.lobbyId]) {
                lobbies[socket.lobbyId][id].interval = interval;
            }
            io.to(socket.lobbyId).emit('updateInterval', interval);
        }
    });

    socket.on('disconnect', () => {
        const lobby = lobbies[socket.lobbyId];
        if (lobby) {
            delete lobby[socket.id];
            io.to(socket.lobbyId).emit('userList', lobby);
        }
    });
});

server.listen(3000, () => {
    console.log('Server kører på http://localhost:3000');
});