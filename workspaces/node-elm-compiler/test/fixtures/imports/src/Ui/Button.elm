module Ui.Button exposing (primary, secondary)

-- Elm rejects import cycles, but the search must still stop when it meets one.
import Page.Home
import Html exposing (Html)


primary : String -> Html msg
primary label =
    Html.text label


secondary : String -> Html msg
secondary label =
    Html.text label
