"use client";

import { useEffect, useMemo, useState } from "react";

type Priority = "Baja" | "Media" | "Alta";

type Task = {
  id: number;
  title: string;
  category: string;
  priority: Priority;
  dueDate: string;
  completed: boolean;
};

const initialTasks: Task[] = [
  {
    id: 1,
    title: "Preparar proyecto",
    category: "Trabajo",
    priority: "Alta",
    dueDate: "2026-08-28",
    completed: false,
  },
  {
    id: 2,
    title: "Comprar material",
    category: "Personal",
    priority: "Media",
    dueDate: "2026-08-29",
    completed: false,
  },
  {
    id: 3,
    title: "Revisar correo",
    category: "Trabajo",
    priority: "Baja",
    dueDate: "2026-08-27",
    completed: true,
  },
];

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Personal");
  const [priority, setPriority] = useState<Priority>("Media");
  const [dueDate, setDueDate] = useState("");
  const [filter, setFilter] = useState("Todas");

  useEffect(() => {
    const saved = localStorage.getItem("organizer-tasks");

    if (saved) {
      setTasks(JSON.parse(saved));
    } else {
      setTasks(initialTasks);
    }
  }, []);

  useEffect(() => {
    if (tasks.length > 0) {
      localStorage.setItem("organizer-tasks", JSON.stringify(tasks));
    }
  }, [tasks]);

  const addTask = () => {
    if (!title.trim()) return;

    const newTask: Task = {
      id: Date.now(),
      title: title.trim(),
      category,
      priority,
      dueDate,
      completed: false,
    };

    setTasks((current) => [...current, newTask]);

    setTitle("");
    setDueDate("");
    setPriority("Media");
  };

  const toggleTask = (id: number) => {
    setTasks((current) =>
      current.map((task) =>
        task.id === id
          ? { ...task, completed: !task.completed }
          : task
      )
    );
  };

  const deleteTask = (id: number) => {
    setTasks((current) => current.filter((task) => task.id !== id));
  };

  const filteredTasks = useMemo(() => {
    if (filter === "Todas") return tasks;

    if (filter === "Pendientes") {
      return tasks.filter((task) => !task.completed);
    }

    if (filter === "Completadas") {
      return tasks.filter((task) => task.completed);
    }

    return tasks.filter((task) => task.category === filter);
  }, [tasks, filter]);

  const completed = tasks.filter((task) => task.completed).length;
  const pending = tasks.filter((task) => !task.completed).length;

  return (
    <main className="container">
      <header className="header">
        <div>
          <p className="eyebrow">MI ORGANIZADOR</p>
          <h1>Organiza tu día</h1>
          <p className="subtitle">
            Ten tus tareas y objetivos bajo control.
          </p>
        </div>

        <div className="stats">
          <div className="stat-card">
            <strong>{pending}</strong>
            <span>Pendientes</span>
          </div>

          <div className="stat-card">
            <strong>{completed}</strong>
            <span>Completadas</span>
          </div>
        </div>
      </header>

      <section className="add-card">
        <h2>Nueva tarea</h2>

        <div className="form-grid">
          <input
            type="text"
            placeholder="¿Qué necesitas hacer?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addTask();
            }}
          />

          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option>Personal</option>
            <option>Trabajo</option>
            <option>Estudios</option>
            <option>Salud</option>
            <option>Otros</option>
          </select>

          <select
            value={priority}
            onChange={(e) =>
              setPriority(e.target.value as Priority)
            }
          >
            <option value="Baja">Prioridad baja</option>
            <option value="Media">Prioridad media</option>
            <option value="Alta">Prioridad alta</option>
          </select>

          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />

          <button onClick={addTask}>+ Añadir tarea</button>
        </div>
      </section>

      <section className="toolbar">
        <div className="filters">
          {[
            "Todas",
            "Pendientes",
            "Completadas",
            "Personal",
            "Trabajo",
            "Estudios",
          ].map((item) => (
            <button
              key={item}
              className={filter === item ? "active" : ""}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </section>

      <section className="tasks">
        {filteredTasks.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">✓</div>
            <h3>No hay tareas aquí</h3>
            <p>
              Añade una tarea nueva para empezar a organizarte.
            </p>
          </div>
        ) : (
          filteredTasks.map((task) => (
            <article
              key={task.id}
              className={`task ${task.completed ? "completed" : ""}`}
            >
              <button
                className="check"
                onClick={() => toggleTask(task.id)}
                aria-label="Completar tarea"
              >
                {task.completed ? "✓" : ""}
              </button>

              <div className="task-content">
                <h3>{task.title}</h3>

                <div className="task-info">
                  <span>{task.category}</span>

                  <span
                    className={`priority ${task.priority
                      .toLowerCase()
                      .replace(" ", "-")}`}
                  >
                    {task.priority}
                  </span>

                  {task.dueDate && (
                    <span>
                      📅{" "}
                      {new Date(
                        `${task.dueDate}T00:00:00`
                      ).toLocaleDateString("es-ES")}
                    </span>
                  )}
                </div>
              </div>

              <button
                className="delete"
                onClick={() => deleteTask(task.id)}
                aria-label="Eliminar tarea"
              >
                🗑
              </button>
            </article>
          ))
        )}
      </section>
    </main>
  );
}
