"use client";

import { useState } from "react";
import type { CharacterProfile } from "@/types";
import { X } from "lucide-react";

interface CharacterEditorProps {
  profile: CharacterProfile;
  allCharacters: CharacterProfile[];
  onSave: (updated: CharacterProfile) => void;
  onCancel: () => void;
}

export default function CharacterEditor({
  profile,
  allCharacters,
  onSave,
  onCancel,
}: CharacterEditorProps) {
  const [edited, setEdited] = useState<CharacterProfile>(
    JSON.parse(JSON.stringify(profile))
  );

  const updateField = (field: string, value: unknown) => {
    setEdited((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-card p-4 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">Edit: {profile.name}</h3>
          <button onClick={onCancel} className="p-1 hover:bg-secondary rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              className="w-full px-3 py-2 border rounded-md bg-background"
              value={edited.name}
              onChange={(e) => updateField("name", e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Aliases (comma separated)
            </label>
            <input
              className="w-full px-3 py-2 border rounded-md bg-background"
              value={edited.aliases.join(", ")}
              onChange={(e) =>
                updateField(
                  "aliases",
                  e.target.value.split(",").map((s) => s.trim()).filter(Boolean)
                )
              }
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Personality Traits (comma separated)
            </label>
            <input
              className="w-full px-3 py-2 border rounded-md bg-background"
              value={edited.personality.traits.join(", ")}
              onChange={(e) =>
                updateField("personality", {
                  ...edited.personality,
                  traits: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                })
              }
            />
            <label className="block text-sm font-medium mb-1 mt-2">
              Description
            </label>
            <textarea
              className="w-full px-3 py-2 border rounded-md bg-background"
              rows={3}
              value={edited.personality.description}
              onChange={(e) =>
                updateField("personality", {
                  ...edited.personality,
                  description: e.target.value,
                })
              }
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Worldview</label>
            <textarea
              className="w-full px-3 py-2 border rounded-md bg-background"
              rows={2}
              value={edited.worldview}
              onChange={(e) => updateField("worldview", e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Values (comma separated)
            </label>
            <input
              className="w-full px-3 py-2 border rounded-md bg-background"
              value={edited.values.join(", ")}
              onChange={(e) =>
                updateField(
                  "values",
                  e.target.value.split(",").map((s) => s.trim()).filter(Boolean)
                )
              }
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Speaking Style
            </label>
            <textarea
              className="w-full px-3 py-2 border rounded-md bg-background"
              rows={2}
              value={edited.speakingStyle}
              onChange={(e) => updateField("speakingStyle", e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Background</label>
            <textarea
              className="w-full px-3 py-2 border rounded-md bg-background"
              rows={3}
              value={edited.background}
              onChange={(e) => updateField("background", e.target.value)}
            />
          </div>
        </div>

        <div className="sticky bottom-0 bg-card p-4 border-t flex items-center justify-end gap-3">
          <button
            className="px-4 py-2 border rounded-md hover:bg-secondary transition-colors"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            onClick={() => onSave(edited)}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
