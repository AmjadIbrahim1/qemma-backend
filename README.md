# ⚙️ Qemma Backend

<div align="center">

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-336791?style=for-the-badge&logo=postgresql&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-010101?style=for-the-badge&logo=socket.io&logoColor=white)

**Backend for Qemma — an AI-powered Learning Management System**

</div>

---

## 📌 Project Overview

**Qemma Backend** is the **server-side application** of the **Qemma** project — an AI-powered Learning Management System (LMS). It provides the API layer, real-time communication, and data persistence for the platform.

**Its role in the project:** the backend is the engine of Qemma. It exposes the REST API consumed by the frontend, manages users, courses, and content in the databases, handles real-time events via Socket.IO, and hosts the AI features of the platform.

> **Status:** Repository scaffold — issue/PR templates are set up and the tech stack is defined. Implementation is in progress.

---

## 🏗️ Project Architecture — The Qemma Ecosystem

Qemma is **one project split across three repositories**:

| Repository | Role in the project | Link |
|------------|--------------------|------|
| **Qema-Graduation-Project** | Documentation hub — SRS, ERD, timelines, testing & user manual | [Open](https://github.com/AmjadIbrahim1/Qema-Graduation-Project) |
| **qemma-backend** *(this repo)* | Backend API & real-time server (Node.js, Express, PostgreSQL, Redis) | [Open](https://github.com/AmjadIbrahim1/qemma-backend) |
| **qemma-frontend** | Frontend web application (React, Redux Toolkit, WebRTC) | [Open](https://github.com/AmjadIbrahim1/qemma-frontend) |

> 📖 Start with the [Qema-Graduation-Project](https://github.com/AmjadIbrahim1/Qema-Graduation-Project) repository for the full system documentation (SRS, ERD, timelines).

---

## 🛠️ Tech Stack

| Technology | Purpose |
|------------|---------|
| **Node.js** | Runtime environment |
| **Express.js** | Web framework |
| **PostgreSQL** | Primary relational database |
| **MongoDB** | Document database |
| **Redis** | Caching & real-time data |
| **Prisma** | ORM & migrations |
| **Socket.IO** | Real-time communication |

---

## 🌿 Branching Strategy

| Branch | Purpose |
|--------|---------|
| `main` | Production |
| `develop` | Integration |
| `feature/*` | New features |

---

## 📁 Project Structure

```
qemma-backend/
├── .github/
│   ├── ISSUE_TEMPLATE/      # Issue templates
│   ├── FEATURE_TEMPLATE/    # Feature request template
│   └── pull_request_template.md
└── README.md
```

---

## 🚀 Getting Started

> Detailed setup instructions will be added as the implementation progresses.

### Planned setup

```bash
# Clone the repository
git clone https://github.com/AmjadIbrahim1/qemma-backend.git
cd qemma-backend

# Install dependencies (once package.json is added)
npm install

# Configure environment variables
cp .env.example .env

# Run database migrations
npx prisma migrate dev

# Start the development server
npm run dev
```

---

## 🤝 Contributing

This repository includes **issue templates**, a **feature request template**, and a **pull request template** to standardize contributions. Please follow the branching strategy above when contributing.

---

## 👨‍💻 Author

**Amjad Ibrahim**

- GitHub: [AmjadIbrahim1](https://github.com/AmjadIbrahim1)
