module Main exposing (main)

import Html exposing (Html)
import Page.Home
-- A line comment between imports does not end the import section.
{- A block comment
   that spans several lines
   does not end it either. -}
import Ui.Button
    exposing
        ( primary
        , secondary
        )
import Ui.Icon


main : Html msg
main =
    Page.Home.view
