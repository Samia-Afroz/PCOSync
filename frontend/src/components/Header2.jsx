import { Sparkles } from "lucide-react";

export function Header() {
  return (
    <header className="mb-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center text-white">
          <Sparkles size={20} />
        </div>

        <div>
          <p class="text-xl font-semibold mb-4 text-purple-600">
            PCOS Cycle Tracker
          </p>
        </div>
      </div>
    </header>
  );
}
